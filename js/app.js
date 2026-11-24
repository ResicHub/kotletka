// Kotletka — main UI. Plain JavaScript, no build step.
(function () {
  const CFG = window.APP_CONFIG;
  const { t } = I18N;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- State ----------------
  const S = {
    db: { places: [], dishes: [], reviews: [], users: [] },
    stack: [{ view: 'map' }],
    placesQuery: '', placesType: '', placesLimit: 60,
    mapOnlyReviewed: false, topMode: 'top', topCat: { g: '', s: '' },
    dishQuery: '', dishCat: { g: '', s: '' }, placesLunch: false,
    loaded: false, offline: false,
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
    };
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
      IX.placeStat[p.id] = { count: rs.length, dishes: (IX.dishesByPlace[p.id] || []).length,
        avg: rs.length ? rs.reduce((a, r) => a + (+r.rating), 0) / rs.length : null };
    });
  }

  // ---------------- Data loading ----------------
  async function loadData(showErrors) {
    try {
      const data = await API.call('getAll');
      S.db = data; S.offline = false; S.loaded = true;
      API.store.set('cache_db', data);
    } catch (e) {
      S.offline = e.code !== 'not_configured';
      if (showErrors) toast(I18N.err(e.code), true);
    }
    // keep the signed-in user's name in sync with the users list
    if (API.user && IX) {
      const u = (S.db.users || []).find(x => x.id === API.user.id);
      if (u) u.name = API.user.name;
    }
    buildIndexes(); render(); refreshMarkers();
    if (S.loaded) setTimeout(maybeMotivate, 1200);
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
    API.store.set('cache_db', S.db);
    render(); refreshMarkers();
  }

  // ---------------- Navigation ----------------
  const cur = () => S.stack[S.stack.length - 1];
  function go(view, params = {}) {
    S.stack.push({ view, ...params });
    try { history.pushState({ d: S.stack.length }, ''); } catch (e) {}
    render(); window.scrollTo(0, 0); $('#view').scrollTop = 0;
  }
  function back() {
    if (S.stack.length > 1) { S.stack.pop(); render(); }
  }
  function switchTab(tab) {
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
  const fmtPrice = p => (p === null || p === '' || p === undefined || isNaN(p)) ? '' : `${Math.round(p)} ${CFG.CURRENCY}`;
  function fmtDate(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(I18N.lang === 'ru' ? 'ru-RU' : 'en-GB',
      sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const userName = id => (API.user && API.user.id === id) ? API.user.name : (IX.user[id] ? IX.user[id].name : '?');
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
    wrap.addEventListener('click', e => { if (e.target === wrap) closeSheet(); });
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

  async function busy(btn, fn) {
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    try { return await fn(); }
    catch (e) { toast(I18N.err(e.code), true); throw e; }
    finally { if (btn) { btn.disabled = false; btn.classList.remove('loading'); } }
  }

  // Resize photos in the browser so uploads stay small and fast.
  function resizeImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  // ---------------- Sign-in ----------------
  // `retry` runs automatically after a successful sign-in, so the user doesn't have to tap again.
  let afterLogin = null;
  async function requireLogin(retry) {
    if (API.user && await API.ensureSignedIn()) return true;
    afterLogin = retry || null;
    openSignInSheet();
    return false;
  }
  function signInBlock() {
    return `<div class="gbtn"></div>`;
  }
  function openSignInSheet() {
    openSheet(t('sign_in'), `<p class="muted">${t('sign_in_needed')}</p>${signInBlock()}`, w => {
      const g = $('.gbtn', w); if (g) API.renderSignInButton(g).catch(() => {});
    });
  }
  API.onAuth(u => {
    if (u && $('.sheet-wrap')) closeSheet();
    if (u) toast((I18N.lang === 'ru' ? 'Привет, ' : 'Hi, ') + u.name);
    render();
    if (u && afterLogin) { const fn = afterLogin; afterLogin = null; setTimeout(fn, 250); }
    if (!u) afterLogin = null;
  });

  // ---------------- Views ----------------
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
    $('#hdr-title').textContent = title || CFG.APP_NAME;
    $('#hdr-back').hidden = S.stack.length < 2;
    $('#hdr-lang').textContent = I18N.lang === 'ru' ? 'EN' : 'RU';
    $('#banner').innerHTML = [
      !API.CONFIGURED ? `<div class="banner warn">${t('not_configured')}</div>` : '',
      S.offline ? `<div class="banner off">${t('offline_cached')}</div>` : '',
    ].join('');
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
    const fn = { places: viewPlaces, top: viewTop, profile: viewProfile, place: viewPlace, dish: viewDish }[c.view];
    v.innerHTML = fn ? fn(c) : '';
    const g = $('.gbtn', v); if (g) API.renderSignInButton(g).catch(() => {});
  }

  // ----- Places list -----
  function filteredPlaces() {
    const q = S.placesQuery.trim().toLowerCase().replace(/ё/g, 'е');
    let list = S.db.places.filter(p => (!S.placesType || placeTypes(p).includes(S.placesType)) && (!S.placesLunch || hasLunch(p)));
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
      <div class="item-sub">${esc(I18N.types(placeTypes(p)))}${p.address ? ' · ' + esc(p.address) : ''}</div>
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
    const lunchChip = `<button class="chip ${S.placesLunch ? 'on' : ''}" data-act="places-lunch">${icon('lunch')} ${t('has_lunch')}</button><span class="chip-sep"></span>`;
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
  function dishRow(d, showPlace) {
    const st = IX.dishStat[d.id];
    const photo = dishPhoto(d);
    const place = IX.place[d.place_id];
    return `<button class="item" data-act="open-dish" data-id="${esc(d.id)}">
      ${photo ? `<img class="thumb" loading="lazy" src="${esc(API.photoUrl(photo, 200))}" alt="">` : `<div class="thumb ph">${icon('camera')}</div>`}
      <div class="item-main"><div class="item-title">${esc(d.name)}</div>
      <div class="item-sub">${showPlace && place ? esc(place.name) + ' · ' : ''}${esc(I18N.cat(d.category))}${fmtPrice(d.price) ? ' · ' + fmtPrice(d.price) : ''}</div>
      <div class="item-sub small">${t('reviews_n', st.count)}</div></div>
      ${badge(st.avg, st.count)}</button>`;
  }
  function viewPlace(c) {
    const p = IX.place[c.id];
    if (!p) return `<div class="empty">${I18N.err('not_found')}</div>`;
    const st = IX.placeStat[p.id];
    const dishes = (IX.dishesByPlace[p.id] || []).slice();
    const top = dishes.filter(d => IX.dishStat[d.id].count).sort((a, b) => IX.dishStat[b.id].score - IX.dishStat[a.id].score).slice(0, 3);
    const q = S.dishQuery.trim().toLowerCase();
    const shown = dishes.filter(d => catMatch(d, S.dishCat) && (!q || d.name.toLowerCase().includes(q)))
      .sort((a, b) => (IX.dishStat[b.id].count - IX.dishStat[a.id].count) || a.name.localeCompare(b.name));
    return `<div class="pad">
      <div class="card hero">
        <div class="hero-top"><div>
          <div class="item-sub">${esc(I18N.types(placeTypes(p)))}</div>
          <h1>${esc(p.name)}</h1>
          ${p.address ? `<div class="item-sub">${icon('pin')} ${esc(p.address)}</div>` : ''}
        </div>${badge(st.avg, st.count)}</div>
        <div class="item-sub small">${t('dishes_n', st.dishes)} · ${t('reviews_n', st.count)}</div>
        <div class="row-btns left">
          <button class="btn ghost sm" data-act="show-on-map" data-id="${esc(p.id)}">${icon('map')} ${t('tab_map')}</button>
          ${API.isAdmin ? `<button class="btn ghost sm" data-act="edit-place" data-id="${esc(p.id)}">${icon('edit')} ${t('edit')}</button>
          <button class="btn ghost sm danger-text" data-act="delete-place" data-id="${esc(p.id)}">${icon('trash')} ${t('delete')}</button>` : ''}
        </div>
      </div>
      ${lunchCard(p, dishes)}
      ${top.length ? `<h3>${t('top_here')}</h3><div class="list compact">${top.map(d => dishRow(d)).join('')}</div>` : ''}
      <h3>${t('dishes_n', dishes.length)}</h3>
      ${dishes.length > 6 ? `<div class="search">${icon('search')}<input id="dish-q" type="search" placeholder="${t('search_dishes')}" value="${esc(S.dishQuery)}"></div>` : ''}
      ${catFilter(dishes, S.dishCat, 'dish')}
      </div>
      <div class="list" id="dish-list">${shown.length ? shown.map(d => dishRow(d)).join('') : `<div class="empty">${t('no_dishes')}</div>`}</div>
      <button class="fab" data-act="add-dish" data-id="${esc(p.id)}">${icon('plus')}<span>${t('add_dish')}</span></button>`;
  }

  // Business lunch block on the place page
  function lunchCard(p, dishes) {
    const lunchDishes = dishes.filter(d => I18N.normCat(d.category) === 'business_lunch');
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
      ${lunchDishes.length ? `<div class="label small muted">${t('lunch_dishes')}</div><div class="list compact inset">${lunchDishes.map(d => dishRow(d)).join('')}</div>` : ''}
      <button class="btn ghost sm" data-act="add-lunch-dish" data-id="${esc(p.id)}">${icon('plus')} ${t('add_dish')}</button>
    </div>`;
  }

  // ----- Dish -----
  function reviewCard(r, withContext) {
    const mine = API.user && r.user_id === API.user.id;
    const name = userName(r.user_id);
    const d = IX.dish[r.dish_id]; const p = IX.place[r.place_id];
    const canDelete = mine || API.isAdmin;
    const edited = r.updated_at && r.created_at && (new Date(r.updated_at) - new Date(r.created_at) > 60000);
    return `<div class="review ${mine ? 'mine' : ''}">
      <div class="review-head">
        <div class="avatar">${initials(name)}</div>
        <div class="review-who"><b>${esc(name)}</b>${mine ? ` <span class="tag">${t('you')}</span>` : ''}
          <div class="item-sub small">${fmtDate(r.created_at)}${edited ? ' · ' + t('edited') : ''}</div></div>
        <span class="badge ${ratingClass(+r.rating)}">${+r.rating}<small>/10</small></span>
      </div>
      ${withContext && d ? `<button class="ctx" data-act="open-dish" data-id="${esc(d.id)}">${esc(d.name)} <span class="muted">${t('at_place')} ${esc(p ? p.name : '')}</span></button>` : ''}
      ${r.comment ? `<p class="review-text">${esc(r.comment)}</p>` : ''}
      ${r.photo_id ? `<img class="review-photo" loading="lazy" src="${esc(API.photoUrl(r.photo_id, 800))}" data-act="view-photo" data-src="${esc(API.photoUrl(r.photo_id, 1600))}" alt="">` : ''}
      ${(mine || canDelete) && !withContext ? `<div class="row-btns left">
        ${mine ? `<button class="btn ghost sm" data-act="edit-review" data-id="${esc(r.dish_id)}">${icon('edit')} ${t('edit')}</button>` : ''}
        ${canDelete ? `<button class="btn ghost sm danger-text" data-act="delete-review" data-id="${esc(r.id)}">${icon('trash')} ${t('delete')}</button>` : ''}
      </div>` : ''}
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
          <div class="item-sub">${esc(I18N.catFull(d.category))}${fmtPrice(d.price) ? ' · ' + fmtPrice(d.price) : ''}</div>
          <h1>${esc(d.name)}</h1>
          <button class="link" data-act="open-place" data-id="${esc(p.id)}">${icon('pin')} ${esc(p.name || '')}</button>
        </div>${badge(st.avg, st.count)}</div>
        ${d.description ? `<p class="desc">${esc(d.description)}</p>` : ''}
        <div class="item-sub small">${t('reviews_n', st.count)}</div>
        ${API.isAdmin ? `<div class="row-btns left">
          <button class="btn ghost sm" data-act="edit-dish" data-id="${esc(d.id)}">${icon('edit')} ${t('edit')}</button>
          <button class="btn ghost sm danger-text" data-act="delete-dish" data-id="${esc(d.id)}">${icon('trash')} ${t('delete')}</button></div>` : ''}
      </div>
      <button class="btn primary wide" data-act="edit-review" data-id="${esc(d.id)}">${icon('star')} ${mine ? t('edit_review') : t('write_review')}</button>
      <div class="reviews">${reviews.length ? reviews.map(r => reviewCard(r)).join('') : `<div class="empty">${t('no_reviews')}</div>`}</div>
    </div>`;
  }

  // ----- Top -----
  function viewTop() {
    const seg = `<div class="seg"><button class="${S.topMode === 'top' ? 'on' : ''}" data-act="top-mode" data-v="top">${t('top_dishes')}</button>
      <button class="${S.topMode === 'latest' ? 'on' : ''}" data-act="top-mode" data-v="latest">${t('latest_reviews')}</button></div>`;
    if (S.topMode === 'latest') {
      const list = S.db.reviews.slice().sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))).slice(0, 40);
      return `<div class="pad">${seg}<div class="reviews">${list.length ? list.map(r => reviewCard(r, true)).join('') : `<div class="empty">${t('nothing_here')}</div>`}</div></div>`;
    }
    const rated = S.db.dishes.filter(d => IX.dishStat[d.id].count);
    const list = rated.filter(d => catMatch(d, S.topCat))
      .sort((a, b) => IX.dishStat[b.id].score - IX.dishStat[a.id].score).slice(0, 50);
    return `<div class="pad">${seg}${catFilter(rated, S.topCat, 'top')}<p class="muted small">${t('top_hint')}</p></div>
      <div class="list ranked">${list.length ? list.map((d, i) => `<div class="rank-row"><span class="rank">${i + 1}</span>${dishRow(d, true)}</div>`).join('')
        : `<div class="empty">${t('nothing_here')}</div>`}</div>`;
  }

  // ----- Profile -----
  function viewProfile() {
    const u = API.user;
    const langs = `<div class="card"><div class="label">${t('language')}</div><div class="seg">
      <button class="${I18N.lang === 'en' ? 'on' : ''}" data-act="set-lang" data-v="en">English</button>
      <button class="${I18N.lang === 'ru' ? 'on' : ''}" data-act="set-lang" data-v="ru">Русский</button></div></div>`;
    const foot = `<p class="muted small center">${t('install_hint')}</p>
      <p class="muted small center">Map data © OpenStreetMap contributors</p>`;
    if (!u) return `<div class="pad"><div class="card center"><p>${t('sign_in_needed')}</p>${signInBlock()}</div>${langs}${foot}</div>`;
    const mine = S.db.reviews.filter(r => r.user_id === u.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return `<div class="pad">
      <div class="card profile">
        <div class="avatar big">${initials(u.name)}</div>
        <div class="grow"><div class="item-title">${esc(u.name)} ${u.role === 'admin' ? `<span class="tag">${t('admin')}</span>` : ''}</div>
        <div class="item-sub small">${t('reviews_n', mine.length)}</div></div>
      </div>
      <div class="row-btns"><button class="btn ghost" data-act="edit-name">${icon('edit')} ${t('change_name')}</button>
      <button class="btn ghost" data-act="sign-out">${t('sign_out')}</button></div>
      ${langs}
      <h3>${t('my_reviews')}</h3>
      <div class="reviews">${mine.length ? mine.map(r => reviewCard(r, true)).join('') : `<div class="empty">${t('nothing_here')}</div>`}</div>
      ${foot}</div>`;
  }

  // ---------------- Map ----------------
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
  function placeForm(place, latlng) {
    const edit = !!place; place = place || { name: '', address: '', types: [] };
    const chosen = new Set(edit ? placeTypes(place) : []);
    openSheet(edit ? t('edit') : t('add_place'), `<form class="form" id="f-place">
      <label>${t('name')}<input name="name" required maxlength="80" value="${esc(place.name)}"></label>
      <div class="label">${t('types_pick')}</div>
      <div class="chips wrap type-pick">${I18N.TYPES.map(k => `<button type="button" class="chip ${chosen.has(k) ? 'on' : ''}" data-k="${k}">${esc(I18N.type(k))}</button>`).join('')}</div>
      <label>${t('address')} <span class="muted">(${t('optional')})</span><input name="address" maxlength="120" value="${esc(place.address)}"></label>
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-place', w); $('input', f).focus();
      $('.type-pick', f).addEventListener('click', e => {
        const b = e.target.closest('[data-k]'); if (!b) return;
        chosen.has(b.dataset.k) ? chosen.delete(b.dataset.k) : chosen.add(b.dataset.k);
        b.classList.toggle('on', chosen.has(b.dataset.k));
      });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        if (!chosen.size) { toast(t('pick_one_type'), true); return; }
        const data = { ...Object.fromEntries(new FormData(f)), types: I18N.TYPES.filter(k => chosen.has(k)) };
        const btn = $('button[type=submit]', f);
        const res = await busy(btn, () => edit
          ? API.call('editPlace', { place: { ...data, id: place.id } })
          : API.call('addPlace', { place: { ...data, lat: latlng.lat, lng: latlng.lng } })).catch(() => null);
        if (!res) return;
        upsert('places', res); closeSheet(); afterChange(); toast(t('saved'));
        if (!edit) go('place', { id: res.id });
      });
    });
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
  function photoPickerHtml(existingId) {
    return `<div class="photo-pick">
        <img class="ph-prev" ${existingId ? `src="${esc(API.photoUrl(existingId, 400))}"` : 'hidden'} alt="">
        <label class="btn ghost sm">${icon('camera')} ${t('add_photo')}<input class="ph-in" type="file" accept="image/*" hidden></label>
        <button type="button" class="btn ghost sm danger-text ph-rm" ${existingId ? '' : 'hidden'}>${t('remove_photo')}</button>
      </div>`;
  }
  function bindPhotoPicker(root) {
    const st = { photo: null, removePhoto: false };
    const prev = $('.ph-prev', root), inp = $('.ph-in', root), rm = $('.ph-rm', root);
    inp.addEventListener('change', async () => {
      const file = inp.files[0]; if (!file) return;
      try {
        st.photo = await resizeImage(file, 1280);
        st.removePhoto = false; prev.src = st.photo; prev.hidden = false; rm.hidden = false;
      } catch (err) { toast(t('error'), true); }
    });
    rm.addEventListener('click', () => {
      st.photo = null; st.removePhoto = true; prev.hidden = true; rm.hidden = true; inp.value = '';
    });
    return st;
  }

  function reviewForm(dish) {
    const me = API.user.id;
    const existing = (IX.reviewsByDish[dish.id] || []).find(r => r.user_id === me);
    let rating = existing ? +existing.rating : null;
    const starBtns = Array.from({ length: 10 }, (_, i) =>
      `<button type="button" class="star" data-r="${i + 1}" aria-label="${i + 1}">${icon('star')}</button>`).join('');
    openSheet(existing ? t('edit_review') : t('write_review'), `<form class="form" id="f-review">
      <div class="label">${esc(dish.name)} <span class="muted">· ${esc((IX.place[dish.place_id] || {}).name || '')}</span></div>
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
        const btn = $('button[type=submit]', f);
        const res = await busy(btn, () => API.call('saveReview', { review: {
          dish_id: dish.id, rating, comment: new FormData(f).get('comment'), photo: ph.photo, removePhoto: ph.removePhoto } })).catch(() => null);
        if (!res) return;
        upsert('reviews', res); closeSheet(); afterChange(); toast(t('saved'));
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
        <label>${t('lunch_menu')} <span class="muted">(${t('optional')})</span><textarea name="lunch_menu" rows="4" maxlength="600" placeholder="${t('lunch_menu_ph')}">${esc(place.lunch_menu || '')}</textarea></label>
      </div>
      <button class="btn primary wide" type="submit">${t('save')}</button></form>`, w => {
      const f = $('#f-lunch', w);
      const paint = () => {
        f.querySelectorAll('#l-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === state));
        $('#l-yes', f).hidden = state !== 'yes';
      };
      paint();
      $('#l-seg', f).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { state = b.dataset.v; paint(); } });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(f));
        const res = await busy($('button[type=submit]', f), () => API.call('updateLunch', { id: place.id, lunch: state, ...data })).catch(() => null);
        if (!res) return;
        upsert('places', res); closeSheet(); afterChange(); toast(t('saved'));
      });
    });
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
    'places-lunch': () => { S.placesLunch = !S.placesLunch; S.placesLimit = 60; render(); },
    'edit-lunch': async el => { const id = el.dataset.id; if (await requireLogin(() => lunchForm(IX.place[id]))) lunchForm(IX.place[id]); },
    'add-lunch-dish': async el => {
      const id = el.dataset.id;
      if (await requireLogin(() => dishForm(id, null, 'business_lunch'))) dishForm(id, null, 'business_lunch');
    },
    'top-mode': el => { S.topMode = el.dataset.v; render(); },
    'set-lang': el => { I18N.setLang(el.dataset.v); render(); refreshMarkers(); },
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
      pickMode = true; renderMapOverlay();
    },
    'pick-cancel': () => { pickMode = false; renderMapOverlay(); },
    'pick-confirm': () => { const c = map.getCenter(); pickMode = false; renderMapOverlay(); placeForm(null, c); },
    'edit-place': el => placeForm(IX.place[el.dataset.id]),
    'delete-place': async el => {
      if (!(await confirmDialog(t('confirm_delete_place')))) return;
      const res = await busy(null, () => API.call('deletePlace', { id: el.dataset.id })).catch(() => null); if (!res) return;
      S.db.places = S.db.places.filter(p => p.id !== res.id);
      S.db.dishes = S.db.dishes.filter(d => d.place_id !== res.id);
      S.db.reviews = S.db.reviews.filter(r => r.place_id !== res.id);
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
      const res = await busy(null, () => API.call('deleteReview', { id: el.dataset.id })).catch(() => null); if (!res) return;
      S.db.reviews = S.db.reviews.filter(r => r.id !== res.id); afterChange(); toast(t('deleted'));
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
    $('#hdr-back').addEventListener('click', () => { try { history.back(); } catch (e) { back(); } });
    $('#hdr-lang').addEventListener('click', () => { I18N.setLang(I18N.lang === 'ru' ? 'en' : 'ru'); render(); refreshMarkers(); });
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
    if (cached) { S.db = cached; S.loaded = true; }
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
