// Talks to the Apps Script backend (or to an in-browser fake backend in DEMO mode) and handles Google sign-in.
(function () {
  const CFG = window.APP_CONFIG;
  const DEMO = !CFG.API_URL;

  class ApiError extends Error { constructor(code) { super(code); this.code = code; } }

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  // ---------- Auth state ----------
  let token = null;      // Google ID token (JWT)
  let user = null;       // {id, name, role}
  const listeners = [];
  const onAuth = fn => listeners.push(fn);
  const emitAuth = () => listeners.forEach(fn => fn(user));

  function tokenExp(t) {
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }
    catch (e) { return 0; }
  }
  const tokenValid = () => token && (DEMO || tokenExp(token) - Date.now() > 60000);

  // ---------- Transport ----------
  async function call(action, payload = {}) {
    const body = { action, ...payload };
    if (token) body.token = token;
    if (DEMO) return demoCall(body);
    let res;
    try {
      // text/plain body = "simple request": no CORS preflight, which Apps Script does not support
      res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body) });
    } catch (e) { throw new ApiError('network'); }
    let json;
    try { json = await res.json(); } catch (e) { throw new ApiError('server_error'); }
    if (!json.ok) {
      if (json.error === 'bad_token' || json.error === 'token_expired') { token = null; store.del('auth'); }
      throw new ApiError(json.error);
    }
    return json.data;
  }

  // ---------- Google sign-in (Google Identity Services) ----------
  let gisReady = null;
  let pendingResolve = null;
  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => {
        google.accounts.id.initialize({
          client_id: CFG.GOOGLE_CLIENT_ID,
          callback: resp => onCredential(resp.credential),
          auto_select: true,
          use_fedcm_for_prompt: true,
        });
        resolve();
      };
      s.onerror = () => reject(new ApiError('network'));
      document.head.appendChild(s);
    });
    return gisReady;
  }

  async function onCredential(cred) {
    token = cred;
    try {
      user = await call('me');
      store.set('auth', { token, user });
      emitAuth();
      if (pendingResolve) { pendingResolve(true); pendingResolve = null; }
    } catch (e) {
      token = null; user = null;
      if (pendingResolve) { pendingResolve(false); pendingResolve = null; }
      window.dispatchEvent(new CustomEvent('api-error', { detail: e.code || 'error' }));
    }
  }

  // Draws the official Google button into `el`.
  async function renderSignInButton(el) {
    if (DEMO) return;
    await loadGis();
    google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with',
      locale: window.I18N.lang });
  }

  // Before any write: make sure we have a fresh token. Tries silent refresh, returns false if user must click.
  async function ensureSignedIn() {
    if (user && tokenValid()) return true;
    if (DEMO) return false;
    if (!user) return false;
    await loadGis();
    return new Promise(resolve => {
      pendingResolve = resolve;
      google.accounts.id.prompt();
      setTimeout(() => { if (pendingResolve === resolve) { pendingResolve = null; resolve(false); } }, 8000);
    });
  }

  async function demoSignIn() {
    token = 'demo';
    user = await call('me');
    store.set('auth_demo', { token, user });
    emitAuth();
  }

  function signOut() {
    token = null; user = null;
    store.del(DEMO ? 'auth_demo' : 'auth');
    if (!DEMO && window.google && google.accounts) google.accounts.id.disableAutoSelect();
    emitAuth();
  }

  function restore() {
    const saved = store.get(DEMO ? 'auth_demo' : 'auth', null);
    if (saved && saved.user) { token = saved.token; user = saved.user; }
    if (!DEMO && CFG.GOOGLE_CLIENT_ID) loadGis().catch(() => {});
  }

  // ---------- DEMO backend (mirrors backend/Code.gs rules) ----------
  let demoDb = null;
  function demoLoad() {
    if (!demoDb) demoDb = store.get('demo_db', null) || JSON.parse(JSON.stringify(window.DEMO_SEED));
    return demoDb;
  }
  const demoSave = () => store.set('demo_db', demoDb);
  const newId = () => 'i' + Math.random().toString(36).slice(2, 12);
  const nowIso = () => new Date().toISOString();
  const norm = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');

  async function demoCall(req) {
    await new Promise(r => setTimeout(r, 150)); // feel of a network
    const db = demoLoad();
    const me = () => {
      if (req.token !== 'demo') throw new ApiError('auth_required');
      return db.users.find(u => u.id === 'demo_me');
    };
    const admin = () => { if (me().role !== 'admin') throw new ApiError('forbidden'); };
    const dropReviews = pred => { db.reviews = db.reviews.filter(r => !pred(r)); };
    let out;
    switch (req.action) {
      case 'getAll': return JSON.parse(JSON.stringify(db));
      case 'me': return { ...me() };
      case 'updateProfile': {
        const u = me(); const name = String(req.name || '').trim().slice(0, 40);
        if (!name) throw new ApiError('name_required');
        u.name = name; out = { ...u }; break;
      }
      case 'addPlace': {
        const u = me(); const p = req.place;
        if (!String(p.name || '').trim()) throw new ApiError('name_required');
        if (db.places.some(x => norm(x.name) === norm(p.name) && Math.abs(x.lat - p.lat) < 0.002 && Math.abs(x.lng - p.lng) < 0.003))
          throw new ApiError('place_exists');
        out = { id: newId(), name: p.name.trim(), address: (p.address || '').trim(), lat: +p.lat, lng: +p.lng,
          type: p.type || 'other', created_by: u.id, created_at: nowIso() };
        db.places.push(out); break;
      }
      case 'editPlace': {
        admin(); const p = db.places.find(x => x.id === req.place.id);
        if (!p) throw new ApiError('not_found');
        Object.assign(p, { name: req.place.name.trim(), address: (req.place.address || '').trim(), type: req.place.type });
        out = p; break;
      }
      case 'deletePlace': {
        admin(); dropReviews(r => r.place_id === req.id);
        db.dishes = db.dishes.filter(d => d.place_id !== req.id);
        db.places = db.places.filter(p => p.id !== req.id); out = { id: req.id }; break;
      }
      case 'addDish': {
        const u = me(); const d = req.dish;
        if (!String(d.name || '').trim()) throw new ApiError('name_required');
        if (db.dishes.some(x => x.place_id === d.place_id && norm(x.name) === norm(d.name))) throw new ApiError('dish_exists');
        out = { id: newId(), place_id: d.place_id, name: d.name.trim(), description: (d.description || '').trim(),
          category: d.category || 'other', price: d.price === '' || d.price == null ? null : Math.round(+d.price),
          photo_id: d.photo || '', created_by: u.id, created_at: nowIso() };
        db.dishes.push(out); break;
      }
      case 'editDish': {
        admin(); const d = db.dishes.find(x => x.id === req.dish.id);
        if (!d) throw new ApiError('not_found');
        Object.assign(d, { name: req.dish.name.trim(), description: (req.dish.description || '').trim(), category: req.dish.category,
          price: req.dish.price === '' || req.dish.price == null ? null : Math.round(+req.dish.price) });
        if (req.dish.removePhoto) d.photo_id = '';
        if (req.dish.photo) d.photo_id = req.dish.photo;
        out = d; break;
      }
      case 'deleteDish': {
        admin(); dropReviews(r => r.dish_id === req.id);
        db.dishes = db.dishes.filter(d => d.id !== req.id); out = { id: req.id }; break;
      }
      case 'saveReview': {
        const u = me(); const r = req.review; const rating = Math.round(+r.rating);
        if (!(rating >= 0 && rating <= 10)) throw new ApiError('bad_rating');
        const dish = db.dishes.find(d => d.id === r.dish_id);
        if (!dish) throw new ApiError('dish_not_found');
        let rev = db.reviews.find(x => x.dish_id === dish.id && x.user_id === u.id);
        if (!rev) {
          rev = { id: newId(), dish_id: dish.id, place_id: dish.place_id, user_id: u.id, photo_id: '', created_at: nowIso() };
          db.reviews.push(rev);
        }
        Object.assign(rev, { rating, comment: String(r.comment || '').trim().slice(0, 500), updated_at: nowIso() });
        if (r.removePhoto) rev.photo_id = '';
        if (r.photo) rev.photo_id = r.photo;
        out = rev; break;
      }
      case 'deleteReview': {
        const u = me(); const rev = db.reviews.find(x => x.id === req.id);
        if (!rev) throw new ApiError('not_found');
        if (rev.user_id !== u.id && u.role !== 'admin') throw new ApiError('forbidden');
        dropReviews(x => x.id === req.id); out = { id: req.id }; break;
      }
      default: throw new ApiError('unknown_action');
    }
    demoSave();
    return JSON.parse(JSON.stringify(out));
  }

  function photoUrl(id, size = 800) {
    if (!id) return '';
    if (id.startsWith('data:')) return id;
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${size}`;
  }

  window.API = {
    DEMO, call, onAuth, restore, signOut, demoSignIn, renderSignInButton, ensureSignedIn, photoUrl, store,
    get user() { return user; },
    get isAdmin() { return !!user && user.role === 'admin'; },
    setUserName(name) {
      if (!user) return;
      user.name = name;
      store.set(DEMO ? 'auth_demo' : 'auth', { token, user });
    },
    resetDemo() { store.del('demo_db'); demoDb = null; },
  };
})();
