// Talks to the Apps Script backend and handles Google sign-in.
(function () {
  const CFG = window.APP_CONFIG;
  const CONFIGURED = !!(CFG.API_URL && CFG.GOOGLE_CLIENT_ID);

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
  const tokenValid = () => token && tokenExp(token) - Date.now() > 60000;

  // ---------- Transport ----------
  async function call(action, payload = {}) {
    const body = { action, ...payload };
    if (token) body.token = token;
    if (!CFG.API_URL) throw new ApiError('not_configured');
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
        if (!window.google || !google.accounts) { gisReady = null; reject(new ApiError('network')); return; }
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
    if (!CONFIGURED) return;
    await loadGis();
    google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with',
      locale: window.I18N.lang });
  }

  // Before any write: make sure we have a fresh token. Tries silent refresh, returns false if user must click.
  async function ensureSignedIn() {
    if (user && tokenValid()) return true;
    if (!user || !CONFIGURED) return false;
    await loadGis();
    return new Promise(resolve => {
      pendingResolve = resolve;
      google.accounts.id.prompt();
      setTimeout(() => { if (pendingResolve === resolve) { pendingResolve = null; resolve(false); } }, 8000);
    });
  }

  function signOut() {
    token = null; user = null;
    store.del('auth');
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    emitAuth();
  }

  function restore() {
    const saved = store.get('auth', null);
    if (saved && saved.user) { token = saved.token; user = saved.user; }
    if (CONFIGURED) loadGis().catch(() => {});
  }

  function photoUrl(id, size = 800) {
    if (!id) return '';
    if (id.startsWith('data:')) return id;
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${size}`;
  }

  window.API = {
    CONFIGURED, call, onAuth, restore, signOut, renderSignInButton, ensureSignedIn, photoUrl, store,
    get user() { return user; },
    get isAdmin() { return !!user && user.role === 'admin'; },
    setUserName(name) {
      if (!user) return;
      user.name = name;
      store.set('auth', { token, user });
    },
  };
})();
