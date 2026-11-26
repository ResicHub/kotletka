// Kotletka — main UI. Plain JavaScript, no build step.
(function () {
  const CFG = window.APP_CONFIG;
  const { t } = I18N;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- State ----------------
  const S = {
    db: { places: [], dishes: [], reviews: [], place_reviews: [], users: [], reactions: [], wishlist: [] },
    stack: [{ view: 'map' }],
    placesQuery: '', placesType: '', placesLimit: 60,
    mapOnlyReviewed: false, topMode: 'top', topCat: { g: '', s: '' },
    dishQuery: '', dishCat: { g: '', s: '' }, placesLunch: false, placesOpen: false,
    dishSort: 'rating', topSort: 'rating', // 'rating' | 'reviews'
    loaded: false, offline: false, loading: 0,
  };
  let IX = {};

  // Bayesian average: dishes with few reviews are pulled toward the city mean.
  const PRIOR = 2;
  function buildIndexes() {
    const db = S.db;
    const by = (arr, k) => { const m = {}; arr.forEach(x => { (m[x[k]] = m[x[k]] || []).push(x); }); return m; };
    IX = {
      place: Object.fromEntries(db.places.map(p => [p.id, p])),
      dish: Object.fromEntries(db.dishes.map(d => [d.id, d])),
      user: Object.fromEntries(db.users.map(u => [u.id, u])),
      dishesByPlace: by(db.dishes, 'place_id'),
      reviewsByDish: by(db.reviews, 'dish_id'),
      reviewsByPlace: by(db.reviews, 'place_id'),
      placeReviewsByPlace: by(db.place_reviews || [], 'place_id'),
    };
    const me = API.user && API.user.id;
    IX.react = {};
    (db.reactions || []).forEach(x => {
      const o = IX.react[x.review_id] = IX.react[x.review_id] || { heart: 0, clown: 0, mine: '' };
      if (o[x.kind] !== undefined) o[x.kind]++;
      if (x.user_id === me) o.mine = x.kind;
    });
    IX.wish = new Set(db.wishlist || []);
    IX.statsCache = {};
    const all = db.reviews.map(r => +r.rating);
    IX.mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 7;
    IX.dishStat = {};
    db.dishes.forEach(d => {
      const rs = IX.reviewsByDish[d.id] || [];
      const sum = rs.reduce((a, r) => a + (+r.rating), 0);
      IX.dishStat[d.id] = { count: rs.length, avg: rs.length ? sum / rs.length : null,
        score: (PRIOR * IX.mean + sum) / (PRIOR + rs.length) };
    });
    IX.placeStat = {};
    db.places.forEach(p => {
      const rs = IX.reviewsByPlace[p.id] || [];
      const prs = IX.placeReviewsByPlace[p.id] || [];
      IX.placeStat[p.id] = { count: rs.length, dishes: (IX.dishesByPlace[p.id] || []).length,
        avg: rs.length ? rs.reduce((a, r) => a + (+r.rating), 0) / rs.length : null,
        // the establishment's own rating (place reviews)
        pCount: prs.length, pAvg: prs.length ? prs.reduce((a, r) => a + (+r.rating), 0) / prs.length : null };
    });
  }

  // ---------------- Data loading ----------------
  async function loadData(showErrors) {
    S.loading++; renderBanner();
    try {
      const data = await API.call('getAll');
      data.reactions = data.reactions || []; data.wishlist = data.wishlist || []; data.place_reviews = data.place_reviews || [];
      if (!API.user) delete data.badges_shown;
      S.db = data; S.offline = false; S.loaded = true;
      API.store.set('cache_db', data);
    } catch (e) {
      S.offline = e.code !== 'not_configured';
      if (showErrors) toast(I18N.err(e.code), true);
    } finally { S.loading--; }
    // keep the signed-in user's name in sync with the users list
    if (API.user && IX) {
      const u = (S.db.users || []).find(x => x.id === API.user.id);
      if (u) u.name = API.user.name;
    }
    buildIndexes(); render(); refreshMarkers();
    if (S.loaded) { checkNewBadges(); setTimeout(maybeMotivate, 1200); }
  }

  // ---------------- New badge celebration ----------------
  // Each badge is celebrated ONCE in total, on whichever device the user is on when it is reached.
  // The list of celebrated badges is kept in the Sheet (Users.badges_shown), so other devices don't repeat it.
  // The very first check only records the badges the user already has (no fireworks for old badges).
  const celebrateQueue = [];
  let celebrating = false;
  function checkNewBadges() {
    if (!API.user || !window.BADGES || !S.loaded) return;
    if (!('badges_shown' in S.db)) return;            // no fresh signed-in data yet (or old backend): do nothing
    const st = userStats(API.user.id);
    const earned = window.BADGES.filter(b => { try { return b.test(st); } catch (e) { return false; } }).map(b => b.id);
    if (S.db.badges_shown === null) {                 // first time for this user: remember silently
      S.db.badges_shown = earned.slice();
      API.call('markBadges', { ids: earned }).catch(() => {});
      return;
    }
    const fresh = earned.filter(id => !S.db.badges_shown.includes(id));
    if (!fresh.length) return;
    S.db.badges_shown.push(...fresh);
    API.call('markBadges', { ids: fresh }).catch(() => {});
    fresh.forEach(id => celebrateQueue.push(id));      // one popup per badge, one after another
    if (!celebrating) nextCelebration();
  }
  function nextCelebration() {
    const id = celebrateQueue.shift();
    const b = id && window.BADGES.find(x => x.id === id);
    if (!b) { celebrating = false; return; }
    celebrating = true;
    const [title, desc] = badgeText(b);
    const el = document.createElement('div');
    el.className = 'celebrate';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="badge-ico" style="background:linear-gradient(135deg,${b.c[0]},${b.c[1]})">${b.emoji}</span>
      <div class="celebrate-text"><div class="celebrate-kicker">${t('new_badge')}</div>
      <div class="celebrate-title">${esc(title)}</div><div class="celebrate-desc">${esc(desc)}</div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    confetti(b.c);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.remove(); nextCelebration(); }, 700);
    }, 5500);
  }
  // Lightweight confetti on a full-screen canvas
  function confetti(colors) {
    let calm = false; // "reduce motion" on the device: fewer pieces, but still a celebration
    try { calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    const c = document.createElement('canvas');
    c.className = 'confetti';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    document.body.appendChild(c);
    const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
    const palette = [...colors, '#e4572e', '#f2b01e', '#1f9d55', '#3b82f6', '#ec4899', '#ffffff'];
    const parts = Array.from({ length: calm ? 60 : 160 }, (_, i) => {
      const left = i % 2 === 0;                       // two bursts from the top corners
      return {
        x: left ? W * 0.15 : W * 0.85, y: H * 0.12,
        vx: (left ? 1 : -1) * (2 + Math.random() * 6) + (Math.random() - 0.5) * 3,
        vy: -4 - Math.random() * 7,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        color: palette[Math.floor(Math.random() * palette.length)],
        round: Math.random() < 0.3,
      };
    });
    const start = performance.now();
    (function frame(now) {
      const tt = now - start;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = tt > 2600 ? Math.max(0, 1 - (tt - 2600) / 900) : 1;
      parts.forEach(p => {
        p.vy += 0.18; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.5, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
        ctx.restore();
      });
      if (tt < 3500) requestAnimationFrame(frame); else c.remove();
    })(start);
  }

  // ---------------- Friendly messages (js/messages.js) ----------------
  // Shown on app open, at most once every SHOW_EVERY_HOURS (remembered per device).
  let motiveTimer = null;
  function pickMessage() {
    const M = window.MESSAGES; if (!M) return null;
    const lang = I18N.lang;
    let last = '';
    try { last = localStorage.getItem('motive_last_text') || ''; } catch (e) {}
    const pick = arr => {
      const options = arr.length > 1 ? arr.filter(x => x !== last) : arr;
      return options[Math.floor(Math.random() * options.length)];
    };
    const fill = (txt, n) => txt.replace('{n}', n).replace('{name}', API.user ? API.user.name : '');
    const me = API.user && API.user.id;
    const groups = [];
    if (me && !S.db.reviews.some(r => r.user_id === me)) groups.push([M.mine, 0]);
    if (S.db.places.length < M.PLACES_BELOW) groups.push([M.places, S.db.places.length]);
    if (S.db.reviews.length < M.REVIEWS_BELOW) groups.push([M.reviews, S.db.reviews.length]);
    if (groups.length) {
      const [g, n] = groups[0];
      return { text: fill(pick(g[lang] || g.en), n) };
    }
    const list = M.fun[lang] || M.fun.en;
    return { text: fill(pick(list), '') };
  }
  function maybeMotivate() {
    const M = window.MESSAGES; if (!M || $('.motive')) return;
    if (celebrating) { setTimeout(maybeMotivate, 3000); return; } // badges first, then the message
    let lastAt = 0;
    try { lastAt = Number(localStorage.getItem('motive_last_at')) || 0; } catch (e) {}
    if (Date.now() - lastAt < M.SHOW_EVERY_HOURS * 3600000) return;
    const msg = pickMessage(); if (!msg) return;
    try { localStorage.setItem('motive_last_at', String(Date.now())); localStorage.setItem('motive_last_text', msg.text); } catch (e) {}
    showMotive(msg, M.SHOW_SECONDS);
  }
  // Fades in, stays for `seconds`, fades out. Not clickable: taps go through to the app underneath.
  function showMotive(msg, seconds) {
    const el = document.createElement('div');
    el.className = 'motive';
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="motive-text">${esc(msg.text)}</div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    motiveTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 800);
    }, 700 + seconds * 1000);
  }

  function upsert(list, obj) {
    const arr = S.db[list]; const i = arr.findIndex(x => x.id === obj.id);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
  }
  function afterChange() {
    buildIndexes();
    setTimeout(checkNewBadges, 400); // after the sheet closes
    API.store.set('cache_db', S.db);
    render(); refreshMarkers();
  }

  // ---------------- Theme ----------------
  // 'auto' (follow the phone), 'light' or 'dark'; stored on this device only
  const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function themeSetting() { try { return localStorage.getItem('theme') || 'auto'; } catch (e) { return 'auto'; } }
  function applyTheme() {
    const th = themeSetting();
    const dark = th === 'dark' || (th === 'auto' && !!darkQuery && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = dark ? '#1d1f24' : '#e4572e';
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', applyTheme);
  applyTheme();

  // ---------------- Navigation ----------------
  const cur = () => S.stack[S.stack.length - 1];
  function go(view, params = {}) {
    S.stack.push({ view, ...params });
    try { history.pushState({ d: S.stack.length }, ''); } catch (e) {}
    render(); window.scrollTo(0, 0); $('#view').scrollTop = 0;
  }
  function back() {
    // leaving the "move place" map screen (Confirm, Cancel or the Back button) returns to the edit form
    const pm = pickMode && pickMode.place && cur().view === 'map' ? pickMode : null;
    if (pm) pickMode = false;
    if (S.stack.length > 1) { S.stack.pop(); render(); }
    if (pm) placeForm(pm.place, pm.result || pm.prev, pm.draft);
  }
  const goBack = () => { try { history.back(); } catch (e) { back(); } };
  function switchTab(tab) {
    if (pickMode && pickMode.place) pickMode = false;
    S.stack = [{ view: tab }];
    render(); $('#view').scrollTop = 0;
    if (tab === 'map') setTimeout(() => map && map.invalidateSize(), 50);
  }
  window.addEventListener('popstate', () => {
    if ($('.sheet-wrap')) { closeSheet(); return; }
    back();
  });

  // ---------------- Small UI helpers ----------------
  function ratingClass(v) { return v == null ? 'r-none' : v >= 7.5 ? 'r-hi' : v >= 5 ? 'r-mid' : 'r-lo'; }
  function badge(avg, count) {
    if (!count) return `<span class="badge r-none">—</span>`;
    return `<span class="badge ${ratingClass(avg)}">${avg.toFixed(1)}</span>`;
  }
  const priceHtml = p => fmtPrice(p) ? ` <span class="price">${fmtPrice(p)}</span>` : '';
  const fmtPrice = p => (p === null || p === '' || p === undefined || isNaN(p)) ? '' : `${Math.round(p)} ${CFG.CURRENCY}`;
  function fmtDate(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(I18N.lang === 'ru' ? 'ru-RU' : 'en-GB',
      sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const userName = id => (API.user && API.user.id === id) ? API.user.name : (IX.user[id] ? IX.user[id].name : '?');
  const userAvatarId = id => (API.user && API.user.id === id) ? (API.user.avatar_id || '') : ((IX.user[id] || {}).avatar_id || '');
  function avatarHtml(id, cls = '') {
    const a = userAvatarId(id);
    return a ? `<img class="avatar ${cls}" src="${esc(API.photoUrl(a, 200))}" alt="">`
      : `<div class="avatar ${cls}">${initials(userName(id))}</div>`;
  }
  // Opening hours: "10:00"–"22:00"; overnight ("18:00"–"02:00") works too. null = unknown
  const toMin = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
  function isOpenNow(p) {
    if (!p.open_from || !p.open_to) return null;
    const d = new Date(), now = d.getHours() * 60 + d.getMinutes(), f = toMin(p.open_from), to = toMin(p.open_to);
    if (f === to) return true;
    return f < to ? now >= f && now < to : now >= f || now < to;
  }
  const hoursText = p => p.open_from && p.open_to ? `${p.open_from}–${p.open_to}`
    : p.open_from ? `${t('lunch_from')} ${p.open_from}` : p.open_to ? `${t('lunch_to')} ${p.open_to}` : '';
  function openTag(p) {
    const o = isOpenNow(p);
    return o === null ? '' : `<span class="open-tag ${o ? 'yes' : 'no'}">${o ? t('open_now') : t('closed_now')}</span>`;
  }
  // Authors can edit their own places and dishes; moderators can edit everything.
  const canEdit = row => !!API.user && !!row && (API.isAdmin || row.created_by === API.user.id);
  const iReviewed = dishId => !!API.user && (IX.reviewsByDish[dishId] || []).some(r => r.user_id === API.user.id);
  function wishBtn(dishId, small) {
    if (iReviewed(dishId)) return '';
    const on = IX.wish.has(dishId);
    return `<button class="btn ${small ? 'sm wish-sm' : 'sm'} ghost wish ${on ? 'on' : ''}" data-act="wish-toggle" data-id="${esc(dishId)}">${on ? '🔖 ' + t('in_wishlist') : '🔖 ' + t('want_to_try')}</button>`;
  }
  // Stats for badges (see js/badges.js)
  function userStats(uid) {
    if (IX.statsCache[uid]) return IX.statsCache[uid];
    const rs = S.db.reviews.filter(r => r.user_id === uid);
    const s = { reviews: rs.length, photos: 0, places: 0, cat: {}, group: {}, low: 0, perfect: 0, minRating: 10,
      night: 0, longest: 0, short: 0, firsts: 0, placesAdded: S.db.places.filter(p => p.created_by === uid).length, hearts: 0, clowns: 0 };
    const places = new Set();
    rs.forEach(r => {
      const d = IX.dish[r.dish_id]; const rating = +r.rating;
      if (r.photo_id) s.photos++;
      places.add(r.place_id);
      if (d) { const k = I18N.normCat(d.category), g = I18N.groupOf(k); s.cat[k] = (s.cat[k] || 0) + 1; s.group[g] = (s.group[g] || 0) + 1; }
      if (rating <= 2) s.low++;
      if (rating === 10) s.perfect++;
      s.minRating = Math.min(s.minRating, rating);
      const h = new Date(r.created_at).getHours(); if (h >= 23 || h < 5) s.night++;
      s.longest = Math.max(s.longest, String(r.comment || '').length);
      if (String(r.comment || '').trim().length < 15) s.short++;
      const first = (IX.reviewsByDish[r.dish_id] || []).reduce((a, b) => (String(a.created_at) <= String(b.created_at) ? a : b));
      if (first.id === r.id) s.firsts++;
      const re = IX.react[r.id]; if (re) { s.hearts += re.heart; s.clowns += re.clown; }
    });
    s.places = places.size;
    // establishment reviews, promotions, most dishes reviewed at one place
    const prs = (S.db.place_reviews || []).filter(r => r.user_id === uid);
    s.placeReviews = prs.length;
    s.placeLow = prs.filter(r => +r.rating <= 2).length;
    s.promos = S.db.places.filter(p => p.promo && p.promo_by === uid).length;
    const perPlace = {}; rs.forEach(r => { perPlace[r.place_id] = (perPlace[r.place_id] || 0) + 1; });
    s.maxAtOnePlace = Math.max(0, ...Object.values(perPlace));
    s.fullPicture = prs.filter(r => (perPlace[r.place_id] || 0) >= 3).length;
    s.avg = rs.length ? rs.reduce((x, r) => x + (+r.rating), 0) / rs.length : 0;
    return (IX.statsCache[uid] = s);
  }
  const badgeText = b => b[I18N.lang] || b.en;
  function badgesHtml(uid, showLocked) {
    const all = window.BADGES || []; const st = userStats(uid);
    const earned = all.filter(b => { try { return b.test(st); } catch (e) { return false; } });
    const list = showLocked ? all : earned;
    if (!list.length) return `<div class="empty small">${t('no_badges')}</div>`;
    return `<div class="badges">${list.map(b => {
      const has = earned.includes(b);
      return `<button class="badge-tile ${has ? '' : 'locked'}" data-act="badge" data-id="${b.id}" data-has="${has ? 1 : 0}">
        <span class="badge-ico" style="background:linear-gradient(135deg,${b.c[0]},${b.c[1]})">${b.emoji}</span>
        <span class="badge-name">${esc(badgeText(b)[0])}</span></button>`;
    }).join('')}</div>`;
  }
  // Moderators can also see the badges nobody has reached yet (greyed out); everyone else sees only earned ones.
  const showLockedBadges = () => { try { return API.isAdmin && localStorage.getItem('show_locked_badges') === '1'; } catch (e) { return false; } };
  function badgesHead(uid) {
    const toggle = API.isAdmin ? `<button class="link small" data-act="toggle-locked-badges">${showLockedBadges() ? t('hide_locked') : t('show_locked')}</button>` : '';
    return `<h3 class="badges-head"><span>${t('badges')} · ${earnedCount(uid)}/${(window.BADGES || []).length}</span>${toggle}</h3>`;
  }
  const earnedCount = uid => (window.BADGES || []).filter(b => { try { return b.test(userStats(uid)); } catch (e) { return false; } }).length;
  const initials = name => esc(String(name || '?').trim().charAt(0).toUpperCase());
  const icon = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  // A place can have several types (stored as "cafe,bar")
  const placeTypes = p => Array.isArray(p.types) && p.types.length ? p.types : String(p.type || 'other').split(',');
  const lunchTime = p => p.lunch_from && p.lunch_to ? `${p.lunch_from}–${p.lunch_to}`
    : p.lunch_from ? `${t('lunch_from')} ${p.lunch_from}` : p.lunch_to ? `${t('lunch_to')} ${p.lunch_to}` : '';
  const hasLunch = p => p.lunch === 'yes';

  let toastTimer;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg; el.className = 'toast show' + (isError ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
  }
  window.addEventListener('api-error', e => toast(I18N.err(e.detail), true));

  // Bottom sheet (modal)
  function openSheet(title, bodyHtml, onMount) {
    closeSheet();
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="close-sheet" aria-label="${t('close')}">${icon('x')}</button></div>
      <div class="sheet-body">${bodyHtml}</div></div>`;
    // Forms close only with ✕ (a stray tap or a text-selection drag must not lose what was typed).
    // Other sheets (photo, badge info) also close on a tap on the backdrop — pressed AND released there.
    let downOnBackdrop = false;
    wrap.addEventListener('pointerdown', e => { downOnBackdrop = e.target === wrap; });
    wrap.addEventListener('click', e => { if (e.target === wrap && downOnBackdrop && !wrap.querySelector('form')) closeSheet(); });
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    if (onMount) onMount(wrap);
    return wrap;
  }
  function closeSheet() { document.querySelectorAll('.sheet-wrap').forEach(w => w.remove()); }

  function confirmDialog(text, okLabel) {
    return new Promise(resolve => {
      const w = openSheet(t('confirm'), `<p class="confirm-text">${esc(text)}</p>
        <div class="row-btns"><button class="btn ghost" data-x="no">${t('cancel')}</button>
        <button class="btn danger" data-x="yes">${esc(okLabel || t('delete'))}</button></div>`);
      w.addEventListener('click', e => {
        const b = e.target.closest('[data-x]'); if (!b) return;
        closeSheet(); resolve(b.dataset.x === 'yes');
      });
    });
  }

  // Instant actions: change the data on the phone right away, save in the background,
  // and put the listed S.db arrays back if the server says no.
  function optimistic(keys, apply, request) {
    const before = {}; keys.forEach(k => { before[k] = S.db[k].slice(); });
    apply(); afterChange();
    return request().then(() => true, e => {
      keys.forEach(k => { S.db[k] = before[k]; });
      afterChange(); toast(I18N.err(e.code), true);
      return false;
    });
  }
  async function busy(btn, fn) {
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    try { return await fn(); }
    catch (e) { toast(I18N.err(e.code), true); throw e; }
    finally { if (btn) { btn.disabled = false; btn.classList.remove('loading'); } }
  }

  // ---------------- Image optimization ----------------
  // Every photo is converted to JPEG in the browser before upload: medium resolution, compressed until it fits
  // the target size. Also drops metadata (GPS location etc.) and fixes rotation. Keeps Google Drive from filling up.
  const IMAGE_PROFILES = {
    photo: { maxSide: 1280, targetKB: 250 },  // dish and review photos
    menu: { maxSide: 1800, targetKB: 500 },   // business lunch menus: bigger, so small text stays readable
    avatar: { maxSide: 400, targetKB: 60, square: true }, // profile pictures, cropped to a square
  };
  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  const dataUrlKB = d => Math.round((d.length - d.indexOf(',') - 1) * 0.75 / 1024);
  async function optimizeImage(file, profileName) {
    const prof = IMAGE_PROFILES[profileName] || IMAGE_PROFILES.photo;
    const src = await loadBitmap(file);
    // square profiles use the centre square of the picture
    const cs = prof.square ? Math.min(src.width, src.height) : 0;
    const sx = prof.square ? (src.width - cs) / 2 : 0, sy = prof.square ? (src.height - cs) / 2 : 0;
    const sw = prof.square ? cs : src.width, sh = prof.square ? cs : src.height;
    let side = Math.min(prof.maxSide, Math.max(sw, sh));
    let out = '';
    for (let round = 0; round < 4; round++) {
      const k = side / Math.max(sw, sh);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // transparent PNGs get a white background
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
      for (const q of [0.85, 0.78, 0.7, 0.62]) {
        out = c.toDataURL('image/jpeg', q);
        if (dataUrlKB(out) <= prof.targetKB) break;
      }
      if (dataUrlKB(out) <= prof.targetKB) break;
      side = Math.round(side * 0.8); // still too big: make it smaller and try again
    }
    if (src.close) src.close();
    return { dataUrl: out, beforeKB: Math.round(file.size / 1024), afterKB: dataUrlKB(out) };
  }
  const fmtKB = kb => kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';

  // ---------------- Sign-in ----------------
  // `retry` runs automatically after a successful sign-in, so the user doesn't have to tap again.
  let afterLogin = null;
  async function requireLogin(retry) {
    if (API.user && await API.ensureSignedIn()) return true;
    afterLogin = retry || null;
    openSignInSheet();
    return false;
  }
  // Phones (and AUTH_MODE 'redirect'): our own Google button that opens Google's page in the same tab.
  // Computers: Google's popup button, plus a fallback link to the redirect flow.
  function signInBlock() {
    const redirectBtn = `<button class="btn gsi-redirect" data-act="signin-redirect">
      <svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
      ${t('sign_in')}</button>`;
    if (API.useRedirect()) return redirectBtn;
    return `<div class="gbtn"></div><button class="link small center-link" data-act="signin-redirect">${t('sign_in_trouble')}</button>`;
  }
  function openSignInSheet() {
    openSheet(t('sign_in'), `<p class="muted">${t('sign_in_needed')}</p>${signInBlock()}`, w => {
      const g = $('.gbtn', w); if (g) API.renderSignInButton(g).catch(() => {});
    });
  }
  API.onAuth(u => {
    if (u && $('.sheet-wrap')) closeSheet();
    if (u) toast((I18N.lang === 'ru' ? 'Привет, ' : 'Hi, ') + u.name);
    if (!u) { S.db.wishlist = []; delete S.db.badges_shown; }
    buildIndexes(); render();
    if (u) loadData(); // fetch the personal "Want to try" list
    if (u && afterLogin) { const fn = afterLogin; afterLogin = null; setTimeout(fn, 250); }
    if (!u) afterLogin = null;
  });

  // ---------------- Views ----------------
  function renderBanner() {
    $('#banner').innerHTML = [
      !API.CONFIGURED ? `<div class="banner warn">${t('not_configured')}</div>` : '',
      S.loading ? `<div class="banner load"><span class="spinner"></span>${t('loading_data')}</div>`
        : S.offline ? `<div class="banner off">${t('offline_cached')}</div>` : '',
    ].join('');
    if (map) map.invalidateSize(); // the banner changes the map's height
  }
  // Horizontal filter rows keep their scroll position across re-renders (key = view + the row's action).
  const chipScroll = {};
  const chipKey = el => { const b = el.querySelector('[data-act]'); return b ? cur().view + ':' + b.dataset.act : ''; };
  function saveChipScroll(v) { v.querySelectorAll('.chips').forEach(el => { const k = chipKey(el); if (k) chipScroll[k] = el.scrollLeft; }); }
  function restoreChipScroll(v) { v.querySelectorAll('.chips').forEach(el => { const k = chipKey(el); if (chipScroll[k]) el.scrollLeft = chipScroll[k]; }); }
  function render() {
    const c = cur();
    document.documentElement.lang = I18N.lang;
    const onMap = c.view === 'map';
    $('#app').classList.toggle('on-map', onMap);
    // header
    const titles = { map: CFG.APP_NAME, places: t('tab_places'), top: t('tab_top'), profile: t('tab_profile') };
    let title = titles[c.view];
    if (c.view === 'place') title = (IX.place[c.id] || {}).name || '';
    if (c.view === 'dish') title = (IX.dish[c.id] || {}).name || '';
    if (c.view === 'user') title = userName(c.id);
    $('#hdr-title').textContent = title || CFG.APP_NAME;
    $('#hdr-back').hidden = S.stack.length < 2;
    renderBanner();
    // tabs
    const tab = S.stack[0].view;
    document.querySelectorAll('#tabs [data-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
      $('span', b).textContent = t('tab_' + b.dataset.tab);
    });
    // body
    const v = $('#view');
    if (onMap) { v.innerHTML = ''; renderMapOverlay(); return; }
    if (!S.loaded && !S.db.places.length) { v.innerHTML = `<div class="empty">${t('loading')}</div>`; return; }
    const fn = { places: viewPlaces, top: viewTop, profile: viewProfile, place: viewPlace, dish: viewDish, user: viewUser }[c.view];
    saveChipScroll(v);
    v.innerHTML = fn ? fn(c) : '';
    restoreChipScroll(v);
    const g = $('.gbtn', v); if (g) API.renderSignInButton(g).catch(() => {});
  }

  // ----- Places list -----
  function filteredPlaces() {
    const q = S.placesQuery.trim().toLowerCase().replace(/ё/g, 'е');
    let list = S.db.places.filter(p => (!S.placesType || placeTypes(p).includes(S.placesType)) && (!S.placesLunch || hasLunch(p))
      && (!S.placesOpen || isOpenNow(p) === true));
    if (q) {
      list = list.filter(p => {
        const hay = (p.name + ' ' + (p.address || '') + ' ' +
          (IX.dishesByPlace[p.id] || []).map(d => d.name).join(' ')).toLowerCase().replace(/ё/g, 'е');
        return hay.includes(q);
      });
    }
    return list.sort((a, b) => (IX.placeStat[b.id].count - IX.placeStat[a.id].count) ||
      (IX.placeStat[b.id].dishes - IX.placeStat[a.id].dishes) || a.name.localeCompare(b.name));
  }
  function placeRow(p) {
    const st = IX.placeStat[p.id];
    return `<button class="item" data-act="open-place" data-id="${esc(p.id)}">
      <div class="item-main"><div class="item-title">${esc(p.name)}</div>
      <div class="item-sub">${esc(I18N.types(placeTypes(p)))}${p.address ? ' · ' + esc(p.address) : ''} ${openTag(p)}</div>
      <div class="item-sub small">${st.dishes ? t('dishes_n', st.dishes) + ' · ' : ''}${t('reviews_n', st.count)}${hasLunch(p) ? ` · <span class="lunch-tag">${t('has_lunch')}${lunchTime(p) ? ' ' + lunchTime(p) : ''}</span>` : ''}</div></div>
      ${badge(st.avg, st.count)}</button>`;
  }
  function placesListHtml() {
    const list = filteredPlaces();
    if (!list.length) return `<div class="empty">${t('no_places')}</div>`;
    const more = list.length > S.placesLimit
      ? `<button class="btn ghost wide" data-act="more-places">${t('show_more')} (${list.length - S.placesLimit})</button>` : '';
    return list.slice(0, S.placesLimit).map(placeRow).join('') + more;
  }
  function chips(values, active, act, labelFn, extraHtml = '', cls = '') {
    return `<div class="chips ${cls}">` + extraHtml + [['', t('all')], ...values.map(v => [v, labelFn(v)])].map(([v, l]) =>
      `<button class="chip ${v === active ? 'on' : ''}" data-act="${act}" data-v="${esc(v)}">${esc(l)}</button>`).join('') + `</div>`;
  }
  // Two-step category filter: group chips, then subcategory chips for the chosen group.
  function catMatch(d, f) {
    if (!f.g) return true;
    if (I18N.groupOf(d.category) !== f.g) return false;
    return !f.s || I18N.normCat(d.category) === f.s;
  }
  function catFilter(dishes, f, act) {
    const groups = I18N.GROUPS.filter(g => dishes.some(d => I18N.groupOf(d.category) === g));
    if (groups.length < 2 && !f.g) return '';
    let html = chips(groups, f.g, act + '-g', g => I18N.group(g));
    const subs = f.g ? I18N.CAT_TREE[f.g].filter(k => dishes.some(d => I18N.normCat(d.category) === k)) : [];
    if (subs.length > 1) html += chips(subs, f.s, act + '-s', k => I18N.cat(k), '', 'sub');
    return html;
  }
  function viewPlaces() {
    const usedTypes = I18N.TYPES.filter(ty => S.db.places.some(p => placeTypes(p).includes(ty)));
    const lunchChip = `<button class="chip ${S.placesOpen ? 'on' : ''}" data-act="places-open">${icon('clock')} ${t('open_now')}</button>
      <button class="chip ${S.placesLunch ? 'on' : ''}" data-act="places-lunch">${icon('lunch')} ${t('has_lunch')}</button><span class="chip-sep"></span>`;
    return `<div class="pad">
      <div class="search">${icon('search')}<input id="places-q" type="search" placeholder="${t('search_places')}" value="${esc(S.placesQuery)}"></div>
      ${chips(usedTypes, S.placesType, 'places-type', I18N.type, lunchChip)}
      </div><div class="list" id="places-list">${placesListHtml()}</div>
      <button class="fab" data-act="add-place-pick">${icon('plus')}<span>${t('add_place')}</span></button>`;
  }

  // ----- Place -----
  // A dish shows its own photo; if it has none, the newest photo from its reviews.
  function dishPhoto(d) {
    if (d.photo_id) return d.photo_id;
    const r = (IX.reviewsByDish[d.id] || []).filter(x => x.photo_id)
      .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))[0];
    return r ? r.photo_id : '';
  }
  // Dish order: 'rating' = best first (few reviews weigh less), 'reviews' = most reviewed first
  function sortDishes(list, mode) {
    const st = id => IX.dishStat[id];
    return list.sort(mode === 'reviews'
      ? (a, b) => (st(b.id).count - st(a.id).count) || (st(b.id).score - st(a.id).score) || a.name.localeCompare(b.name)
      : (a, b) => ((st(b.id).count > 0) - (st(a.id).count > 0)) || (st(b.id).score - st(a.id).score) || a.name.localeCompare(b.name));
  }
  function sortChips(active, act) {
    return `<div class="chips sort-chips"><span class="muted small">${t('sort_by')}</span>${['rating', 'reviews'].map(v =>
      `<button class="chip ${v === active ? 'on' : ''}" data-act="${act}" data-v="${v}">${t('sort_' + v)}</button>`).join('')}</div>`;
  }
  function dishRow(d, showPlace) {
    const st = IX.dishStat[d.id];
    const photo = dishPhoto(d);
    const place = IX.place[d.place_id];
    return `<button class="item" data-act="open-dish" data-id="${esc(d.id)}">
      ${photo ? `<img class="thumb" loading="lazy" src="${esc(API.photoUrl(photo, 200))}" alt="">` : `<div class="thumb ph">${icon('camera')}</div>`}
      <div class="item-main"><div class="item-title">${esc(d.name)}</div>
      <div class="item-sub">${showPlace && place ? esc(place.name) + ' · ' : ''}${esc(I18N.cat(d.category))}${priceHtml(d.price)}</div>
      <div class="item-sub small">${t('reviews_n', st.count)}</div></div>
      ${badge(st.avg, st.count)}</button>`;
  }
  function viewPlace(c) {
    const p = IX.place[c.id];
    if (!p) return `<div class="empty">${I18N.err('not_found')}</div>`;
    const st = IX.placeStat[p.id];
    const dishes = (IX.dishesByPlace[p.id] || []).slice();
    const tab = c.tab || 'dishes';
    const me = API.user && API.user.id;
    const previews = (IX.placeReviewsByPlace[p.id] || []).slice()
      .sort((a, b) => ((b.user_id === me) - (a.user_id === me)) || String(b.created_at).localeCompare(String(a.created_at)));
    const myPreview = previews.find(r => r.user_id === me);
    let body;
    if (tab === 'reviews') {
      body = `<button class="btn primary wide" data-act="edit-place-review" data-id="${esc(p.id)}">${icon('star')} ${myPreview ? t('edit_review') : t('review_place')}</button>
        <div class="reviews">${previews.length ? previews.map(r => reviewCard(r)).join('') : `<div class="empty">${t('no_reviews')}</div>`}</div></div>`;
    } else {
      const q = S.dishQuery.trim().toLowerCase();
      const shown = sortDishes(dishes.filter(d => catMatch(d, S.dishCat) && (!q || d.name.toLowerCase().includes(q))), S.dishSort);
      body = `${dishes.length > 6 ? `<div class="search">${icon('search')}<input id="dish-q" type="search" placeholder="${t('search_dishes')}" value="${esc(S.dishQuery)}"></div>` : ''}
        ${catFilter(dishes, S.dishCat, 'dish')}
        ${dishes.length > 1 ? sortChips(S.dishSort, 'dish-sort') : ''}
        </div>
        <div class="list" id="dish-list">${shown.length ? shown.map(d => dishRow(d)).join('') : `<div class="empty">${t('no_dishes')}</div>`}</div>
        <button class="fab" data-act="add-dish" data-id="${esc(p.id)}">${icon('plus')}<span>${t('add_dish')}</span></button>`;
    }
    return `<div class="pad">
      <div class="card hero">
        <div class="hero-top"><div>
          <div class="item-sub">${esc(I18N.types(placeTypes(p)))}</div>
          <h1>${esc(p.name)}</h1>
          ${p.address ? `<div class="item-sub">${icon('pin')} ${esc(p.address)}</div>` : ''}
          <div class="item-sub hours-row">${icon('clock')} ${hoursText(p) ? esc(hoursText(p)) + ' ' + openTag(p) : `<span class="muted">${t('hours_unknown')}</span>`}
            <button class="link small" data-act="edit-hours" data-id="${esc(p.id)}">${hoursText(p) ? t('edit') : t('add')}</button></div>
        </div>${badge(st.pAvg, st.pCount)}</div>
        <div class="item-sub small">${t('place_rating')}: ${st.pCount ? t('reviews_n', st.pCount) : t('no_ratings')}
          · ${t('dishes_avg')}: ${st.count ? `<b>${st.avg.toFixed(1)}</b> (${t('reviews_n', st.count)})` : '—'}</div>
        <div class="row-btns left">
          <button class="btn ghost sm" data-act="show-on-map" data-id="${esc(p.id)}">${icon('map')} ${t('tab_map')}</button>
          ${canEdit(p) ? `<button class="btn ghost sm" data-act="edit-place" data-id="${esc(p.id)}">${icon('edit')} ${t('edit')}</button>` : ''}
          ${API.isAdmin ? `<button class="btn ghost sm danger-text" data-act="delete-place" data-id="${esc(p.id)}">${icon('trash')} ${t('delete')}</button>` : ''}
        </div>
      </div>
      ${lunchCard(p)}
      ${promoCard(p)}
      <div class="seg place-tabs">
        <button class="${tab === 'dishes' ? 'on' : ''}" data-act="place-tab" data-v="dishes">${t('tab_dishes')} · ${dishes.length}</button>
        <button class="${tab === 'reviews' ? 'on' : ''}" data-act="place-tab" data-v="reviews">${t('tab_place_reviews')} · ${previews.length}</button>
      </div>
      ${body}`;
  }

  // Promotions block on the place page (free text, anyone can update it)
  function promoCard(p) {
    const btn = label => `<button class="btn ghost sm" data-act="edit-promo" data-id="${esc(p.id)}">${icon('edit')} ${label}</button>`;
    if (!p.promo) {
      return `<div class="card lunch-card off"><div class="lunch-head"><span class="promo-ico">🎁</span><span class="grow"><b>${t('promo')}</b> <span class="muted">· ${t('promo_none')}</span></span>${btn(t('add'))}</div></div>`;
    }
    return `<div class="card lunch-card promo-card">
      <div class="lunch-head"><span class="promo-ico">🎁</span><span class="grow"><b>${t('promo')}</b></span>${btn(t('edit'))}</div>
      <p class="promo-text">${esc(p.promo)}</p>
      ${p.promo_at ? `<div class="item-sub small">${t('promo_updated')} ${fmtDate(p.promo_at)}${p.promo_by ? ' · ' + esc(userName(p.promo_by)) : ''}</div>` : ''}
    </div>`;
  }
  function promoForm(place) {
    openSheet(t('promo'), `<form class="form" id="f-promo">
      <div class="label">${esc(place.name)}</div>
      <label>${t('promo')}<textarea name="promo" rows="4" maxlength="500" placeholder="${t('promo_ph')}">${esc(place.promo || '')}</textarea></label>
      <p class="muted small">${t('promo_hint')}</p>
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-promo', w);
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const res = await busy($('button[type=submit]', f), () => API.call('updatePromo', { id: place.id, promo: new FormData(f).get('promo') })).catch(() => null);
        if (!res) return;
        upsert('places', res); closeSheet(); afterChange(); toast(t('saved'));
      });
    });
  }

  // Business lunch block on the place page
  function lunchCard(p) {
    const editBtn = label => `<button class="btn ghost sm" data-act="edit-lunch" data-id="${esc(p.id)}">${icon('edit')} ${label}</button>`;
    if (p.lunch === 'no') {
      return `<div class="card lunch-card off"><div class="lunch-head">${icon('lunch')}<span class="grow muted">${t('lunch_none')}</span>${editBtn(t('edit'))}</div></div>`;
    }
    if (p.lunch !== 'yes') {
      return `<div class="card lunch-card off"><div class="lunch-head">${icon('lunch')}<span class="grow"><b>${t('lunch')}</b> <span class="muted">· ${t('lunch_unknown')}</span></span>${editBtn(t('lunch_add'))}</div></div>`;
    }
    return `<div class="card lunch-card">
      <div class="lunch-head">${icon('lunch')}<span class="grow"><b>${t('lunch')}</b>${lunchTime(p) ? ` <span class="lunch-time">${esc(lunchTime(p))}</span>` : ''}</span>${editBtn(t('edit'))}</div>
      ${p.lunch_menu ? `<p class="lunch-menu">${esc(p.lunch_menu)}</p>` : ''}
      ${p.lunch_photo_id ? `<img class="lunch-photo" loading="lazy" src="${esc(API.photoUrl(p.lunch_photo_id, 800))}" data-act="view-photo" data-src="${esc(API.photoUrl(p.lunch_photo_id, 2000))}" alt="${t('lunch_menu_photo')}">` : ''}
    </div>`;
  }

  // ----- Dish -----
  // r is a dish review (has dish_id) or an establishment review (no dish_id)
  function reviewCard(r, withContext) {
    const mine = API.user && r.user_id === API.user.id;
    const name = userName(r.user_id);
    const isPlace = !r.dish_id;
    const d = IX.dish[r.dish_id]; const p = IX.place[r.place_id];
    const canDelete = mine || API.isAdmin;
    const edited = r.updated_at && r.created_at && (new Date(r.updated_at) - new Date(r.created_at) > 60000);
    const re = IX.react[r.id] || { heart: 0, clown: 0, mine: '' };
    const reactBtn = (kind, emoji) => `<button class="react ${re.mine === kind ? 'on' : ''}" ${mine ? 'disabled' : ''}
      data-act="react" data-id="${esc(r.id)}" data-k="${kind}" aria-label="${t('react_' + kind)}">${emoji}<span>${re[kind] || ''}</span></button>`;
    return `<div class="review ${mine ? 'mine' : ''}">
      <div class="review-head">
        <button class="who-btn" data-act="open-user" data-id="${esc(r.user_id)}">${avatarHtml(r.user_id)}
        <span class="review-who"><span class="who-line"><b>${esc(name)}</b>${mine ? `<span class="tag">${t('you')}</span>` : ''}</span>
          <span class="item-sub small">${fmtDate(r.created_at)}${edited ? ' · ' + t('edited') : ''}</span></span></button>
        <span class="badge ${ratingClass(+r.rating)}">${+r.rating}<small>/10</small></span>
      </div>
      ${withContext && d ? `<button class="ctx" data-act="open-dish" data-id="${esc(d.id)}">${esc(d.name)} <span class="muted">${t('at_place')} ${esc(p ? p.name : '')}</span></button>` : ''}
      ${withContext && isPlace && p ? `<button class="ctx" data-act="open-place-reviews" data-id="${esc(p.id)}">${icon('pin')} ${esc(p.name)} <span class="muted">· ${t('place_review')}</span></button>` : ''}
      ${r.comment ? `<p class="review-text">${esc(r.comment)}</p>` : ''}
      ${r.photo_id ? `<img class="review-photo" loading="lazy" src="${esc(API.photoUrl(r.photo_id, 800))}" data-act="view-photo" data-src="${esc(API.photoUrl(r.photo_id, 1600))}" alt="">` : ''}
      <div class="review-foot">
        ${reactBtn('heart', '❤️')}${reactBtn('clown', '🤡')}
        <span class="grow"></span>
        ${withContext && !mine && d ? wishBtn(d.id, true) : ''}
        ${!withContext && mine ? `<button class="btn ghost sm" data-act="${isPlace ? 'edit-place-review' : 'edit-review'}" data-id="${esc(isPlace ? r.place_id : r.dish_id)}">${icon('edit')} ${t('edit')}</button>` : ''}
        ${!withContext && canDelete ? `<button class="btn ghost sm danger-text" data-act="${isPlace ? 'delete-place-review' : 'delete-review'}" data-id="${esc(r.id)}" aria-label="${t('delete')}">${icon('trash')}</button>` : ''}
      </div>
    </div>`;
  }
  function viewDish(c) {
    const d = IX.dish[c.id];
    if (!d) return `<div class="empty">${I18N.err('not_found')}</div>`;
    const p = IX.place[d.place_id] || {};
    const st = IX.dishStat[d.id];
    const me = API.user && API.user.id;
    const reviews = (IX.reviewsByDish[d.id] || []).slice()
      .sort((a, b) => ((b.user_id === me) - (a.user_id === me)) || String(b.created_at).localeCompare(String(a.created_at)));
    const mine = reviews.find(r => r.user_id === me);
    return `<div class="pad">
      <div class="card hero">
        ${dishPhoto(d) ? `<img class="hero-photo" src="${esc(API.photoUrl(dishPhoto(d), 1000))}" data-act="view-photo" data-src="${esc(API.photoUrl(dishPhoto(d), 1600))}" alt="">` : ''}
        <div class="hero-top"><div>
          <div class="item-sub">${esc(I18N.catFull(d.category))}${priceHtml(d.price)}</div>
          <h1>${esc(d.name)}</h1>
          <button class="link" data-act="open-place" data-id="${esc(p.id)}">${icon('pin')} ${esc(p.name || '')}</button>
        </div>${badge(st.avg, st.count)}</div>
        ${d.description ? `<p class="desc">${esc(d.description)}</p>` : ''}
        <div class="item-sub small">${t('reviews_n', st.count)}</div>
        ${canEdit(d) ? `<div class="row-btns left">
          <button class="btn ghost sm" data-act="edit-dish" data-id="${esc(d.id)}">${icon('edit')} ${t('edit')}</button>
          ${API.isAdmin ? `<button class="btn ghost sm danger-text" data-act="delete-dish" data-id="${esc(d.id)}">${icon('trash')} ${t('delete')}</button>` : ''}</div>` : ''}
      </div>
      <div class="row-btns left dish-actions">${wishBtn(d.id)}
      ${!d.photo_id ? `<button class="btn ghost sm add-photo-btn" data-act="add-dish-photo" data-id="${esc(d.id)}">${icon('camera')} ${t('add_dish_photo')}</button>` : ''}</div>
      <button class="btn primary wide" data-act="edit-review" data-id="${esc(d.id)}">${icon('star')} ${mine ? t('edit_review') : t('write_review')}</button>
      <div class="reviews">${reviews.length ? reviews.map(r => reviewCard(r)).join('') : `<div class="empty">${t('no_reviews')}</div>`}</div>
    </div>`;
  }

  // ----- Top -----
  const allReviews = () => S.db.reviews.concat(S.db.place_reviews || []);
  const byNewest = (a, b) => String(b.created_at).localeCompare(String(a.created_at));
  function viewTop() {
    const seg = `<div class="seg"><button class="${S.topMode === 'top' ? 'on' : ''}" data-act="top-mode" data-v="top">${t('top_dishes')}</button>
      <button class="${S.topMode === 'latest' ? 'on' : ''}" data-act="top-mode" data-v="latest">${t('latest_reviews')}</button></div>`;
    if (S.topMode === 'latest') {
      const list = allReviews().sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))).slice(0, 40);
      return `<div class="pad">${seg}<div class="reviews">${list.length ? list.map(r => reviewCard(r, true)).join('') : `<div class="empty">${t('nothing_here')}</div>`}</div></div>`;
    }
    const rated = S.db.dishes.filter(d => IX.dishStat[d.id].count);
    const list = sortDishes(rated.filter(d => catMatch(d, S.topCat)), S.topSort).slice(0, 50);
    return `<div class="pad">${seg}${catFilter(rated, S.topCat, 'top')}${sortChips(S.topSort, 'top-sort')}
      <p class="muted small">${t(S.topSort === 'reviews' ? 'top_hint_reviews' : 'top_hint')}</p></div>
      <div class="list ranked">${list.length ? list.map((d, i) => `<div class="rank-row"><span class="rank">${i + 1}</span>${dishRow(d, true)}</div>`).join('')
        : `<div class="empty">${t('nothing_here')}</div>`}</div>`;
  }

  // ----- Profile -----
  function profileHead(uid, own) {
    const u = own ? API.user : (IX.user[uid] || { name: '?', role: 'user' });
    const st = userStats(uid);
    return `<div class="card profile">
        <${own ? 'button class="avatar-edit" data-act="edit-avatar"' : 'div class="avatar-edit"'} aria-label="${t('change_avatar')}">${avatarHtml(uid, 'big')}${own ? `<span class="cam">${icon('camera')}</span>` : ''}</${own ? 'button' : 'div'}>
        <div class="grow"><div class="item-title">${esc(userName(uid))} ${u.role === 'admin' ? `<span class="tag">${t('admin')}</span>` : ''}</div>
          <div class="stats-row">
            <span>${t('reviews_n', st.reviews)}</span><span>${t('places_n', st.places)}</span>
            <span><b>${st.hearts}</b> ❤️</span><span><b>${earnedCount(uid)}</b> 🏅</span>
          </div></div>
      </div>`;
  }
  function viewProfile() {
    const u = API.user;
    const th = themeSetting();
    const langs = `<div class="lang-row"><span class="muted small">${t('language')}</span><div class="seg mini">
      <button class="${I18N.lang === 'en' ? 'on' : ''}" data-act="set-lang" data-v="en">EN</button>
      <button class="${I18N.lang === 'ru' ? 'on' : ''}" data-act="set-lang" data-v="ru">RU</button></div></div>
      <div class="lang-row"><span class="muted small">${t('theme')}</span><div class="seg mini">
      ${['auto', 'light', 'dark'].map(v => `<button class="${th === v ? 'on' : ''}" data-act="set-theme" data-v="${v}">${t('theme_' + v)}</button>`).join('')}</div></div>`;
    const foot = `<p class="muted small center">${t('install_hint')}</p>
      <p class="muted small center">Map data © OpenStreetMap contributors</p>`;
    if (!u) return `<div class="pad"><div class="card center"><p>${t('sign_in_needed')}</p>${signInBlock()}</div>${langs}${foot}</div>`;
    const mine = allReviews().filter(r => r.user_id === u.id).sort(byNewest);
    const wish = [...IX.wish].map(id => IX.dish[id]).filter(Boolean);
    return `<div class="pad">
      ${profileHead(u.id, true)}
      <div class="row-btns"><button class="btn ghost" data-act="edit-name">${icon('edit')} ${t('change_name')}</button>
      <button class="btn ghost" data-act="sign-out">${t('sign_out')}</button></div>
      <h3>🔖 ${t('wishlist')}</h3>
      ${wish.length ? `<div class="list compact">${wish.map(d => {
        const p = IX.place[d.place_id] || {}; const st = IX.dishStat[d.id];
        return `<div class="item wish-item"><button class="item-main link-like" data-act="open-dish" data-id="${esc(d.id)}">
            <div class="item-title">${esc(d.name)}</div><div class="item-sub">${esc(p.name || '')}${priceHtml(d.price)}</div></button>
          ${badge(st.avg, st.count)}
          <button class="btn primary sm" data-act="review-from-list" data-id="${esc(d.id)}">${icon('star')} ${t('rate_it')}</button>
          <button class="icon-btn" data-act="wish-remove" data-id="${esc(d.id)}" aria-label="${t('remove')}">${icon('x')}</button></div>`;
      }).join('')}</div>` : `<div class="empty small">${t('wishlist_empty')}</div>`}
      ${badgesHead(u.id)}
      ${badgesHtml(u.id, showLockedBadges())}
      ${langs}
      <h3>${t('my_reviews')}</h3>
      <div class="reviews">${mine.length ? mine.map(r => reviewCard(r, true)).join('') : `<div class="empty">${t('nothing_here')}</div>`}</div>
      ${foot}</div>`;
  }
  function viewUser(c) {
    if (!IX.user[c.id] && !S.db.reviews.some(r => r.user_id === c.id)) return `<div class="empty">${I18N.err('not_found')}</div>`;
    const rs = allReviews().filter(r => r.user_id === c.id).sort(byNewest);
    return `<div class="pad">
      ${profileHead(c.id, false)}
      ${badgesHead(c.id)}
      ${badgesHtml(c.id, showLockedBadges())}
      <h3>${t('reviews_n', rs.length)}</h3>
      <div class="reviews">${rs.length ? rs.map(r => reviewCard(r, true)).join('') : `<div class="empty">${t('nothing_here')}</div>`}</div>
    </div>`;
  }

  // ---------------- Map ----------------
  // pickMode: false, {} = choosing the point of a new place, {place, draft} = moving an existing place
  let map, markerLayer, pickMode = false;
  function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, preferCanvas: true, attributionControl: true })
      .setView(CFG.CITY_CENTER, CFG.CITY_ZOOM);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    // Map tiles: CARTO "Voyager" if a free key is set in config.js, otherwise standard OpenStreetMap (no key needed).
    const osmAttr = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    const tiles = CFG.CARTO_KEY
      ? L.tileLayer('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=' + encodeURIComponent(CFG.CARTO_KEY),
          { maxZoom: 19, attribution: osmAttr + ' © <a href="https://carto.com/attributions">CARTO</a>' })
      : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: osmAttr });
    tiles.addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    refreshMarkers(); // saved data right away, fresh data replaces it when it arrives
    map.on('popupopen', e => {
      const b = e.popup.getElement().querySelector('[data-act]');
      if (b) b.addEventListener('click', () => { map.closePopup(); go('place', { id: b.dataset.id }); });
    });
  }
  function refreshMarkers() {
    if (!map) return;
    markerLayer.clearLayers();
    S.db.places.forEach(p => {
      const st = IX.placeStat[p.id];
      if (S.mapOnlyReviewed && !st.count) return;
      const has = st.count > 0;
      const color = has ? { 'r-hi': '#1f9d55', 'r-mid': '#e8a317', 'r-lo': '#d64545' }[ratingClass(st.avg)] : '#8a8f98';
      const m = L.circleMarker([p.lat, p.lng], {
        radius: has ? 9 : 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: has ? 0.95 : 0.7,
      });
      m.bindPopup(`<div class="pop"><b>${esc(p.name)}</b><div class="item-sub">${esc(I18N.types(placeTypes(p)))}${p.address ? ' · ' + esc(p.address) : ''}</div>
        <div class="item-sub">${has ? '★ ' + st.avg.toFixed(1) + ' · ' : ''}${t('reviews_n', st.count)}</div>
        ${hoursText(p) ? `<div class="item-sub">🕐 ${esc(hoursText(p))} ${openTag(p)}</div>` : ''}
        ${hasLunch(p) ? `<div class="item-sub lunch-tag">${t('has_lunch')}${lunchTime(p) ? ' ' + esc(lunchTime(p)) : ''}</div>` : ''}
        <button class="btn primary sm" data-act="open-place" data-id="${esc(p.id)}">${t('open')}</button></div>`);
      markerLayer.addLayer(m);
    });
  }
  function renderMapOverlay() {
    initMap();
    const o = $('#map-overlay');
    if (pickMode) {
      o.innerHTML = `<div class="pick-pin">${icon('pin-fill')}</div>
        <div class="pick-bar"><p>${t('pick_location')}</p><div class="row-btns">
        <button class="btn ghost" data-act="pick-cancel">${t('cancel')}</button>
        <button class="btn primary" data-act="pick-confirm">${t('confirm')}</button></div></div>`;
      return;
    }
    o.innerHTML = `<div class="map-top">
        <button class="chip float ${S.mapOnlyReviewed ? 'on' : ''}" data-act="map-filter">${icon('star')} ${t('only_reviewed')}</button>
        <button class="icon-btn float" data-act="locate" aria-label="Locate">${icon('locate')}</button>
      </div>
      <button class="fab" data-act="add-place-pick">${icon('plus')}<span>${t('add_place')}</span></button>`;
    setTimeout(() => map.invalidateSize(), 0);
  }

  // ---------------- Forms ----------------
  function selectOptions(keys, labelFn, val) {
    return keys.map(k => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(labelFn(k))}</option>`).join('');
  }
  // New place: latlng = the picked point. Editing: latlng = new point after "Change location" (or null),
  // draft = what was typed before going to the map.
  function placeForm(place, latlng, draft) {
    const edit = !!place; place = place || { name: '', address: '', types: [] };
    const v = { name: place.name, address: place.address || '', open_from: place.open_from || '', open_to: place.open_to || '',
      types: edit ? placeTypes(place) : [], ...(draft || {}) };
    const chosen = new Set(v.types);
    const moved = edit && latlng;
    openSheet(edit ? t('edit') : t('add_place'), `<form class="form" id="f-place">
      <label>${t('name')}<input name="name" required maxlength="80" value="${esc(v.name)}"></label>
      <div class="label">${t('types_pick')}</div>
      <div class="chips wrap type-pick">${I18N.TYPES.map(k => `<button type="button" class="chip ${chosen.has(k) ? 'on' : ''}" data-k="${k}">${esc(I18N.type(k))}</button>`).join('')}</div>
      <label>${t('address')} <span class="muted">(${t('optional')})</span><input name="address" maxlength="120" value="${esc(v.address)}">
        <span class="muted small addr-note" hidden></span></label>
      ${edit ? `<div class="loc-row">${icon('pin')}<span class="grow small ${moved ? '' : 'muted'}">${moved ? t('location_changed') : t('location')}</span>
        <button type="button" class="btn ghost sm" data-move>${t('change_location')}</button></div>` : ''}
      <div class="label">${t('hours')} <span class="muted">(${t('optional')})</span></div>
      <div class="row2"><label>${t('lunch_from')}<input name="open_from" type="time" value="${esc(v.open_from)}"></label>
        <label>${t('lunch_to')}<input name="open_to" type="time" value="${esc(v.open_to)}"></label></div>
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-place', w); $('input', f).focus();
      const addr = $('[name=address]', f);
      // Fill the address from the map point (the user can still change it)
      if (latlng && (!edit || moved)) {
        let typed = false;
        addr.addEventListener('input', () => { typed = true; }, { once: true });
        const note = $('.addr-note', f); note.hidden = false; note.textContent = t('address_finding');
        reverseGeocode(latlng).then(a => {
          note.hidden = true;
          if (a && !typed && (moved || !addr.value)) addr.value = a;
        });
      }
      $('.type-pick', f).addEventListener('click', e => {
        const b = e.target.closest('[data-k]'); if (!b) return;
        chosen.has(b.dataset.k) ? chosen.delete(b.dataset.k) : chosen.add(b.dataset.k);
        b.classList.toggle('on', chosen.has(b.dataset.k));
      });
      const formData = () => ({ ...Object.fromEntries(new FormData(f)), types: I18N.TYPES.filter(k => chosen.has(k)) });
      const mv = $('[data-move]', f);
      if (mv) mv.addEventListener('click', () => {
        closeSheet();
        pickMode = { place, draft: formData(), prev: latlng };
        go('map');
        const at = latlng || { lat: place.lat, lng: place.lng };
        setTimeout(() => map.setView([at.lat, at.lng], 17), 80);
      });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        if (!chosen.size) { toast(t('pick_one_type'), true); return; }
        const data = formData();
        if (latlng) { data.lat = latlng.lat; data.lng = latlng.lng; }
        const btn = $('button[type=submit]', f);
        const res = await busy(btn, () => edit
          ? API.call('editPlace', { place: { ...data, id: place.id } })
          : API.call('addPlace', { place: data })).catch(() => null);
        if (!res) return;
        upsert('places', res); closeSheet(); afterChange(); toast(t('saved'));
        if (!edit) go('place', { id: res.id });
      });
    });
  }

  // Address from coordinates (OpenStreetMap Nominatim; free, max 1 request per second — fine for this app).
  // Returns "улица Ленина, 12" or '' when nothing is found.
  async function reverseGeocode(ll) {
    try {
      const q = new URLSearchParams({ format: 'jsonv2', lat: ll.lat, lon: ll.lng, zoom: 18, addressdetails: 1, 'accept-language': 'ru' });
      const res = await fetch('https://nominatim.openstreetmap.org/reverse?' + q);
      if (!res.ok) return '';
      const a = (await res.json()).address || {};
      const street = a.road || a.pedestrian || a.footway || a.square || a.neighbourhood || a.suburb || '';
      return [street, a.house_number].filter(Boolean).join(', ').slice(0, 120);
    } catch (e) { return ''; }
  }
  function dishForm(placeId, dish, presetCat) {
    const edit = !!dish; dish = dish || { name: '', description: '', category: presetCat || '', price: '' };
    const cat0 = dish.category ? I18N.normCat(dish.category) : '';
    const group0 = cat0 ? I18N.groupOf(cat0) : '';
    const subOptions = g => `<option value="">—</option>` + (I18N.CAT_TREE[g] || []).map(k =>
      `<option value="${k}" ${k === cat0 ? 'selected' : ''}>${esc(I18N.cat(k))}</option>`).join('');
    openSheet(edit ? t('edit') : t('add_dish'), `<form class="form" id="f-dish">
      <label>${t('name')}<input name="name" required maxlength="80" value="${esc(dish.name)}"></label>
      <label>${t('category')}<select name="group" required><option value="">—</option>${I18N.GROUPS.map(g =>
        `<option value="${g}" ${g === group0 ? 'selected' : ''}>${esc(I18N.group(g))}</option>`).join('')}</select></label>
      <label class="sub-wrap" ${group0 && I18N.CAT_TREE[group0].length ? '' : 'hidden'}>${t('subcategory')}<select name="sub">${subOptions(group0)}</select></label>
      <label>${t('price')}, ${CFG.CURRENCY} <span class="muted">(${t('optional')})</span><input name="price" type="number" inputmode="numeric" min="0" step="1" value="${dish.price == null ? '' : esc(dish.price)}"></label>
      <label>${t('description')} <span class="muted">(${t('optional')})</span><textarea name="description" maxlength="300" rows="2">${esc(dish.description)}</textarea></label>
      <div class="label">${t('photo')} <span class="muted">(${t('optional')})</span></div>
      ${photoPickerHtml(dish.photo_id)}
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-dish', w); $('input', f).focus();
      const ph = bindPhotoPicker(f);
      const gSel = $('[name=group]', f), sSel = $('[name=sub]', f), subWrap = $('.sub-wrap', f);
      gSel.addEventListener('change', () => {
        const hasSubs = (I18N.CAT_TREE[gSel.value] || []).length > 0;
        sSel.innerHTML = subOptions(gSel.value); subWrap.hidden = !hasSubs; sSel.required = hasSubs;
      });
      sSel.required = !subWrap.hidden;
      f.addEventListener('submit', async e => {
        e.preventDefault();
        if (ph.busy) return;
        const data = Object.fromEntries(new FormData(f));
        data.category = (I18N.CAT_TREE[data.group] || []).length ? data.sub : data.group;
        delete data.group; delete data.sub;
        if (ph.photo) data.photo = ph.photo;
        if (ph.removePhoto) data.removePhoto = true;
        const btn = $('button[type=submit]', f);
        const res = await busy(btn, () => edit
          ? API.call('editDish', { dish: { ...data, id: dish.id } })
          : API.call('addDish', { dish: { ...data, place_id: placeId } })).catch(() => null);
        if (!res) return;
        upsert('dishes', res); closeSheet(); afterChange(); toast(t('saved'));
        if (!edit) go('dish', { id: res.id });
      });
    });
  }
  // Photo picker used by the dish and review forms. Returns live state {photo, removePhoto}.
  function photoPickerHtml(existingId, label) {
    return `<div class="photo-pick">
        <img class="ph-prev" ${existingId ? `src="${esc(API.photoUrl(existingId, 400))}"` : 'hidden'} alt="">
        <label class="btn ghost sm">${icon('camera')} ${label || t('add_photo')}<input class="ph-in" type="file" accept="image/*" hidden></label>
        <button type="button" class="btn ghost sm danger-text ph-rm" ${existingId ? '' : 'hidden'}>${t('remove_photo')}</button>
        <div class="ph-note muted small" hidden></div>
      </div>`;
  }
  // profile: 'photo' (dishes, reviews) or 'menu' (business lunch menu)
  function bindPhotoPicker(root, profile = 'photo') {
    const st = { photo: null, removePhoto: false, busy: false };
    const prev = $('.ph-prev', root), inp = $('.ph-in', root), rm = $('.ph-rm', root), note = $('.ph-note', root);
    inp.addEventListener('change', async () => {
      const file = inp.files[0]; if (!file) return;
      st.busy = true; note.hidden = false; note.textContent = t('optimizing');
      try {
        const r = await optimizeImage(file, profile);
        st.photo = r.dataUrl; st.removePhoto = false;
        prev.src = r.dataUrl; prev.hidden = false; rm.hidden = false;
        note.textContent = t('optimized', [fmtKB(r.beforeKB), fmtKB(r.afterKB)]);
      } catch (err) { note.hidden = true; toast(t('bad_image'), true); }
      st.busy = false;
    });
    rm.addEventListener('click', () => {
      st.photo = null; st.removePhoto = true; prev.hidden = true; rm.hidden = true; note.hidden = true; inp.value = '';
    });
    return st;
  }

  // Add a photo to a dish that has none (any signed-in user)
  function dishPhotoForm(dish) {
    openSheet(t('add_dish_photo'), `<form class="form" id="f-dphoto">
      <div class="label">${esc(dish.name)}</div>
      ${photoPickerHtml('')}
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-dphoto', w);
      const ph = bindPhotoPicker(f, 'photo');
      $('.ph-in', f).click();
      f.addEventListener('submit', async e => {
        e.preventDefault();
        if (ph.busy) return;
        if (!ph.photo) { toast(t('pick_photo'), true); return; }
        const res = await busy($('button[type=submit]', f), () => API.call('setDishPhoto', { id: dish.id, photo: ph.photo })).catch(() => null);
        if (!res) return;
        upsert('dishes', res); closeSheet(); afterChange(); toast(t('saved'));
      });
    });
  }

  function reviewForm(dish) {
    const existing = (IX.reviewsByDish[dish.id] || []).find(r => r.user_id === API.user.id);
    ratingForm(existing, `${esc(dish.name)} <span class="muted">· ${esc((IX.place[dish.place_id] || {}).name || '')}</span>`,
      (rating, comment, ph) => API.call('saveReview', { review: {
        dish_id: dish.id, rating, comment, photo: ph.photo, removePhoto: ph.removePhoto } }),
      res => {
        upsert('reviews', res);
        S.db.wishlist = (S.db.wishlist || []).filter(x => x !== res.dish_id); // tried it → off the list
      });
  }
  function placeReviewForm(place) {
    const existing = (IX.placeReviewsByPlace[place.id] || []).find(r => r.user_id === API.user.id);
    ratingForm(existing, `${esc(place.name)} <span class="muted">· ${t('place_review_hint')}</span>`,
      (rating, comment, ph) => API.call('savePlaceReview', { review: {
        place_id: place.id, rating, comment, photo: ph.photo, removePhoto: ph.removePhoto } }),
      res => upsert('place_reviews', res));
  }
  // 0–10 rating + comment + photo. save(rating, comment, photo) → Promise of the saved review; done(review) updates the data.
  function ratingForm(existing, labelHtml, save, done) {
    let rating = existing ? +existing.rating : null;
    const starBtns = Array.from({ length: 10 }, (_, i) =>
      `<button type="button" class="star" data-r="${i + 1}" aria-label="${i + 1}">${icon('star')}</button>`).join('');
    openSheet(existing ? t('edit_review') : t('write_review'), `<form class="form" id="f-review">
      <div class="label">${labelHtml}</div>
      <div class="label">${t('your_rating')}: <b id="r-val">${rating == null ? '—' : rating}</b>/10</div>
      <div class="stars"><button type="button" class="star zero" data-r="0">0</button>${starBtns}</div>
      <label>${t('comment')}<textarea name="comment" maxlength="500" rows="3" placeholder="${t('comment_ph')}">${esc(existing ? existing.comment : '')}</textarea></label>
      ${photoPickerHtml(existing && existing.photo_id)}
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-review', w);
      const paint = () => {
        $('#r-val', f).textContent = rating == null ? '—' : rating;
        f.querySelectorAll('.star').forEach(s => s.classList.toggle('on', rating != null && +s.dataset.r <= rating && +s.dataset.r > 0 || (rating === 0 && s.dataset.r === '0')));
      };
      paint();
      $('.stars', f).addEventListener('click', e => { const s = e.target.closest('.star'); if (s) { rating = +s.dataset.r; paint(); } });
      const ph = bindPhotoPicker(f);
      f.addEventListener('submit', async e => {
        e.preventDefault();
        if (rating == null) { toast(I18N.err('bad_rating'), true); return; }
        if (ph.busy) return;
        const btn = $('button[type=submit]', f);
        const res = await busy(btn, () => save(rating, new FormData(f).get('comment'), ph)).catch(() => null);
        if (!res) return;
        done(res);
        closeSheet(); afterChange(); toast(t('saved'));
      });
    });
  }
  function lunchForm(place) {
    let state = place.lunch === 'yes' || place.lunch === 'no' ? place.lunch : '';
    openSheet(t('lunch'), `<form class="form" id="f-lunch">
      <div class="label">${t('lunch_q')}</div>
      <div class="seg" id="l-seg">
        <button type="button" data-v="yes">${t('yes')}</button><button type="button" data-v="no">${t('no')}</button><button type="button" data-v="">${t('unknown')}</button>
      </div>
      <div id="l-yes">
        <div class="row2">
          <label>${t('lunch_from')} <span class="muted">(${t('optional')})</span><input name="lunch_from" type="time" value="${esc(place.lunch_from || '')}"></label>
          <label>${t('lunch_to')} <span class="muted">(${t('optional')})</span><input name="lunch_to" type="time" value="${esc(place.lunch_to || '')}"></label>
        </div>
        <label>${t('lunch_menu')} <span class="muted">(${t('optional')})</span><textarea name="lunch_menu" rows="3" maxlength="600" placeholder="${t('lunch_menu_ph')}">${esc(place.lunch_menu || '')}</textarea></label>
        <div class="label">${t('lunch_menu_photo')} <span class="muted">(${t('optional')})</span></div>
        ${photoPickerHtml(place.lunch_photo_id, t('add_menu_photo'))}
      </div>
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-lunch', w);
      const paint = () => {
        f.querySelectorAll('#l-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === state));
        $('#l-yes', f).hidden = state !== 'yes';
      };
      const ph = bindPhotoPicker(f, 'menu');
      paint();
      $('#l-seg', f).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { state = b.dataset.v; paint(); } });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(f));
        if (ph.busy) return;
        if (ph.photo) data.lunch_photo = ph.photo;
        if (ph.removePhoto) data.removeLunchPhoto = true;
        const res = await busy($('button[type=submit]', f), () => API.call('updateLunch', { id: place.id, lunch: state, ...data })).catch(() => null);
        if (!res) return;
        upsert('places', res); closeSheet(); afterChange(); toast(t('saved'));
      });
    });
  }

  function hoursForm(place) {
    openSheet(t('hours'), `<form class="form" id="f-hours">
      <div class="label">${esc(place.name)}</div>
      <div class="row2"><label>${t('lunch_from')}<input name="open_from" type="time" value="${esc(place.open_from || '')}"></label>
      <label>${t('lunch_to')}<input name="open_to" type="time" value="${esc(place.open_to || '')}"></label></div>
      <p class="muted small">${t('hours_hint')}</p>
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-hours', w);
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(f));
        const res = await busy($('button[type=submit]', f), () => API.call('updateHours', { id: place.id, ...data })).catch(() => null);
        if (!res) return;
        upsert('places', res); closeSheet(); afterChange(); toast(t('saved'));
      });
    });
  }
  function avatarForm() {
    const cur = API.user.avatar_id || '';
    openSheet(t('change_avatar'), `<form class="form" id="f-avatar">
      ${photoPickerHtml(cur, t('choose_photo'))}
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-avatar', w);
      const ph = bindPhotoPicker(f, 'avatar');
      if (!cur) $('.ph-in', f).click();
      f.addEventListener('submit', async e => {
        e.preventDefault();
        if (ph.busy) return;
        if (!ph.photo && !ph.removePhoto) { closeSheet(); return; }
        const res = await busy($('button[type=submit]', f), () => API.call('updateProfile',
          ph.photo ? { avatar: ph.photo } : { removeAvatar: true })).catch(() => null);
        if (!res) return;
        API.setUser({ avatar_id: res.avatar_id });
        const u = S.db.users.find(x => x.id === res.id); if (u) u.avatar_id = res.avatar_id; else S.db.users.push(res);
        closeSheet(); afterChange(); toast(t('saved'));
      });
    });
  }
  function badgeSheet(id, has) {
    const b = (window.BADGES || []).find(x => x.id === id); if (!b) return;
    const [title, desc] = badgeText(b);
    openSheet(t('badge'), `<div class="badge-detail ${has ? '' : 'locked'}">
      <span class="badge-ico big" style="background:linear-gradient(135deg,${b.c[0]},${b.c[1]})">${b.emoji}</span>
      <h2>${esc(title)}</h2><p>${esc(desc)}</p>
      <span class="tag">${has ? t('badge_earned') : '🔒 ' + t('badge_locked')}</span></div>`);
  }

  function nameForm() {
    openSheet(t('change_name'), `<form class="form" id="f-name">
      <label>${t('display_name')}<input name="name" required maxlength="40" value="${esc(API.user.name)}"></label>
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-name', w); $('input', f).select();
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const res = await busy($('button', f), () => API.call('updateProfile', { name: new FormData(f).get('name') })).catch(() => null);
        if (!res) return;
        API.setUserName(res.name);
        const u = S.db.users.find(x => x.id === res.id); if (u) u.name = res.name; else S.db.users.push(res);
        closeSheet(); afterChange(); toast(t('saved'));
      });
    });
  }

  // ---------------- Events ----------------
  const ACTS = {
    'close-sheet': () => closeSheet(),
    'open-place': el => { closeSheet(); S.dishQuery = ''; S.dishCat = { g: '', s: '' }; go('place', { id: el.dataset.id }); },
    'open-dish': el => go('dish', { id: el.dataset.id }),
    'more-places': () => { S.placesLimit += 60; $('#places-list').innerHTML = placesListHtml(); },
    'places-type': el => { S.placesType = el.dataset.v; S.placesLimit = 60; render(); },
    'dish-g': el => { S.dishCat = { g: el.dataset.v, s: '' }; render(); },
    'dish-s': el => { S.dishCat.s = el.dataset.v; render(); },
    'top-g': el => { S.topCat = { g: el.dataset.v, s: '' }; render(); },
    'top-s': el => { S.topCat.s = el.dataset.v; render(); },
    'wish-toggle': async el => {
      const id = el.dataset.id;
      if (!(await requireLogin())) return;
      const on = !IX.wish.has(id);
      toast(on ? t('added_wishlist') : t('removed_wishlist'));
      optimistic(['wishlist'], () => { S.db.wishlist = S.db.wishlist.filter(x => x !== id); if (on) S.db.wishlist.push(id); },
        () => API.call('wishToggle', { dish_id: id, on }));
    },
    'wish-remove': el => {
      const id = el.dataset.id;
      optimistic(['wishlist'], () => { S.db.wishlist = S.db.wishlist.filter(x => x !== id); },
        () => API.call('wishToggle', { dish_id: id, on: false }));
    },
    'review-from-list': el => { const d = IX.dish[el.dataset.id]; if (d) reviewForm(d); },
    'react': async el => {
      if (el.disabled) return;
      if (!(await requireLogin())) return;
      const rid = el.dataset.id, me = API.user.id;
      // same kind again = remove, other kind = switch; the exact wanted state is sent, so quick taps can't get mixed up
      const want = (IX.react[rid] || {}).mine === el.dataset.k ? '' : el.dataset.k;
      optimistic(['reactions'], () => {
        S.db.reactions = S.db.reactions.filter(x => !(x.review_id === rid && x.user_id === me));
        if (want) S.db.reactions.push({ review_id: rid, user_id: me, kind: want });
      }, () => API.call('react', { review_id: rid, kind: el.dataset.k, set: want }));
    },
    'open-user': el => {
      const id = el.dataset.id;
      if (API.user && id === API.user.id) { switchTab('profile'); return; }
      go('user', { id });
    },
    'edit-avatar': () => avatarForm(),
    'signin-redirect': () => API.signInRedirect(API.user && API.user.email),
    'badge': el => badgeSheet(el.dataset.id, el.dataset.has === '1'),
    'edit-hours': async el => { const id = el.dataset.id; if (await requireLogin(() => hoursForm(IX.place[id]))) hoursForm(IX.place[id]); },
    'places-open': () => { S.placesOpen = !S.placesOpen; S.placesLimit = 60; render(); },
    'add-dish-photo': async el => {
      const id = el.dataset.id;
      if (await requireLogin(() => IX.dish[id] && dishPhotoForm(IX.dish[id]))) dishPhotoForm(IX.dish[id]);
    },
    'places-lunch': () => { S.placesLunch = !S.placesLunch; S.placesLimit = 60; render(); },
    'toggle-locked-badges': () => {
      try { localStorage.setItem('show_locked_badges', showLockedBadges() ? '0' : '1'); } catch (e) {}
      render();
    },
    'edit-promo': async el => { const id = el.dataset.id; if (await requireLogin(() => promoForm(IX.place[id]))) promoForm(IX.place[id]); },
    'edit-lunch': async el => { const id = el.dataset.id; if (await requireLogin(() => lunchForm(IX.place[id]))) lunchForm(IX.place[id]); },
    'top-mode': el => { S.topMode = el.dataset.v; render(); },
    'top-sort': el => { S.topSort = el.dataset.v; render(); },
    'dish-sort': el => { S.dishSort = el.dataset.v; render(); },
    'place-tab': el => { cur().tab = el.dataset.v; render(); },
    'open-place-reviews': el => go('place', { id: el.dataset.id, tab: 'reviews' }),
    'edit-place-review': async el => {
      const id = el.dataset.id;
      if (await requireLogin(() => IX.place[id] && placeReviewForm(IX.place[id]))) placeReviewForm(IX.place[id]);
    },
    'delete-place-review': async el => {
      if (!(await requireLogin())) return;
      if (!(await confirmDialog(t('confirm_delete_review')))) return;
      const id = el.dataset.id;
      if (await optimistic(['place_reviews', 'reactions'], () => {
        S.db.place_reviews = S.db.place_reviews.filter(r => r.id !== id);
        S.db.reactions = S.db.reactions.filter(x => x.review_id !== id);
      }, () => API.call('deletePlaceReview', { id }))) toast(t('deleted'));
    },
    'set-lang': el => { I18N.setLang(el.dataset.v); render(); refreshMarkers(); },
    'set-theme': el => { try { localStorage.setItem('theme', el.dataset.v); } catch (e) {} applyTheme(); render(); },
    'map-filter': () => { S.mapOnlyReviewed = !S.mapOnlyReviewed; refreshMarkers(); renderMapOverlay(); },
    'locate': () => {
      try {
        navigator.geolocation.getCurrentPosition(
          pos => map.setView([pos.coords.latitude, pos.coords.longitude], 16),
          () => toast(t('error'), true), { timeout: 8000 });
      } catch (e) { toast(t('error'), true); }
    },
    'show-on-map': el => {
      const p = IX.place[el.dataset.id]; switchTab('map');
      setTimeout(() => { map.setView([p.lat, p.lng], 17); }, 80);
    },
    'add-place-pick': async () => {
      if (!(await requireLogin(() => ACTS['add-place-pick']()))) return;
      if (cur().view !== 'map') switchTab('map');
      pickMode = {}; renderMapOverlay();
    },
    'pick-cancel': () => {
      if (pickMode.place) { goBack(); return; }
      pickMode = false; renderMapOverlay();
    },
    'pick-confirm': () => {
      const c = map.getCenter();
      if (pickMode.place) { pickMode.result = { lat: c.lat, lng: c.lng }; goBack(); return; }
      pickMode = false; renderMapOverlay(); placeForm(null, c);
    },
    'edit-place': el => placeForm(IX.place[el.dataset.id]),
    'delete-place': async el => {
      if (!(await confirmDialog(t('confirm_delete_place')))) return;
      const res = await busy(null, () => API.call('deletePlace', { id: el.dataset.id })).catch(() => null); if (!res) return;
      S.db.places = S.db.places.filter(p => p.id !== res.id);
      S.db.dishes = S.db.dishes.filter(d => d.place_id !== res.id);
      S.db.reviews = S.db.reviews.filter(r => r.place_id !== res.id);
      S.db.place_reviews = S.db.place_reviews.filter(r => r.place_id !== res.id);
      back(); afterChange(); toast(t('deleted'));
    },
    'add-dish': async el => { const id = el.dataset.id; if (await requireLogin(() => dishForm(id))) dishForm(id); },
    'edit-dish': el => dishForm(null, IX.dish[el.dataset.id]),
    'delete-dish': async el => {
      if (!(await confirmDialog(t('confirm_delete_dish')))) return;
      const res = await busy(null, () => API.call('deleteDish', { id: el.dataset.id })).catch(() => null); if (!res) return;
      S.db.dishes = S.db.dishes.filter(d => d.id !== res.id);
      S.db.reviews = S.db.reviews.filter(r => r.dish_id !== res.id);
      back(); afterChange(); toast(t('deleted'));
    },
    'edit-review': async el => {
      const id = el.dataset.id;
      if (await requireLogin(() => IX.dish[id] && reviewForm(IX.dish[id]))) reviewForm(IX.dish[id]);
    },
    'delete-review': async el => {
      if (!(await requireLogin())) return;
      if (!(await confirmDialog(t('confirm_delete_review')))) return;
      const id = el.dataset.id;
      if (await optimistic(['reviews', 'reactions'], () => {
        S.db.reviews = S.db.reviews.filter(r => r.id !== id);
        S.db.reactions = S.db.reactions.filter(x => x.review_id !== id);
      }, () => API.call('deleteReview', { id }))) toast(t('deleted'));
    },
    'view-photo': el => openSheet(t('photo'), `<img class="full-photo" src="${esc(el.dataset.src)}" alt="">`),
    'edit-name': () => nameForm(),
    'sign-out': () => { API.signOut(); },
  };

  function bindEvents() {
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-act]');
      if (!el || el.closest('.leaflet-popup')) return;
      const fn = ACTS[el.dataset.act];
      if (fn) { e.preventDefault(); fn(el); }
    });
    $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); });
    $('#hdr-back').addEventListener('click', goBack);
    $('#hdr-refresh').addEventListener('click', async e => {
      const b = e.currentTarget; b.classList.add('spin'); await loadData(true); b.classList.remove('spin');
    });
    document.addEventListener('input', e => {
      if (e.target.id === 'places-q') { S.placesQuery = e.target.value; S.placesLimit = 60; $('#places-list').innerHTML = placesListHtml(); }
      if (e.target.id === 'dish-q') {
        S.dishQuery = e.target.value;
        const pos = e.target.selectionStart; render();
        const inp = $('#dish-q'); if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (x) {} }
      }
    });
    // refresh when the app comes back to the foreground
    let lastLoad = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoad > 120000) { lastLoad = Date.now(); loadData(); } // loadData also checks for a message
      else maybeMotivate();
    });
  }

  // ---------------- Start ----------------
  function start() {
    API.restore();
    const cached = API.store.get('cache_db', null);
    if (cached) { delete cached.badges_shown; cached.place_reviews = cached.place_reviews || []; S.db = cached; S.loaded = true; } // badge list only from fresh server data
    buildIndexes();
    bindEvents();
    render();
    loadData();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  start();
})();
