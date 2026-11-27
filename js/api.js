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
  // Google ID token (valid ~1 hour) right after sign-in, then the app session from the backend
  // ("ks1.…", valid ~60 days, renewed while the app is used). Both carry `exp` in the middle part.
  let token = null;
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

  const isSession = t => typeof t === 'string' && t.startsWith('ks1.');
  // Takes the user returned by `me`; swaps the Google token for the app session if the backend sent one.
  function acceptMe(u) {
    if (u.session) token = u.session;
    delete u.session;
    user = u;
    store.set('auth', { token, user });
  }

  async function onCredential(cred) {
    token = cred;
    try {
      acceptMe(await call('me'));
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
    if (useRedirect()) return false; // the sign-in sheet offers the redirect button
    await loadGis();
    return new Promise(resolve => {
      pendingResolve = resolve;
      google.accounts.id.prompt();
      setTimeout(() => { if (pendingResolve === resolve) { pendingResolve = null; resolve(false); } }, 8000);
    });
  }

  // ---------- Google sign-in by full-page redirect ----------
  // Works in every mobile browser (the popup flow can get stuck on a white page in some of them).
  // Google sends the user back to this page with #id_token=... ; the backend verifies the token as usual.
  const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
  const isMobile = () => /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent || '') || isStandalone();
  function useRedirect() {
    const mode = CFG.AUTH_MODE || 'auto';
    return mode === 'redirect' || (mode === 'auto' && isMobile());
  }
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
  function signInRedirect(hintEmail) {
    if (!CONFIGURED) return;
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    store.set('oauth_nonce', nonce);
    const p = new URLSearchParams({
      client_id: CFG.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'id_token',
      scope: 'openid email profile', nonce, prompt: 'select_account',
    });
    if (hintEmail) p.set('login_hint', hintEmail);
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
  }
  // Called on start: picks up the token Google put in the address (#id_token=...)
  function takeRedirectResult() {
    const h = location.hash || '';
    if (!/id_token=|error=/.test(h)) return;
    const q = new URLSearchParams(h.slice(1));
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
    const expected = store.get('oauth_nonce', null); store.del('oauth_nonce');
    if (q.get('error')) {
      if (q.get('error') !== 'access_denied') setTimeout(() => window.dispatchEvent(new CustomEvent('api-error', { detail: 'sign_in_failed' })), 500);
      return;
    }
    const idt = q.get('id_token');
    let nonce = '';
    try { nonce = JSON.parse(atob(idt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).nonce; } catch (e) {}
    if (!idt || !expected || nonce !== expected) {
      setTimeout(() => window.dispatchEvent(new CustomEvent('api-error', { detail: 'sign_in_failed' })), 500);
      return;
    }
    onCredential(idt);
  }

  function signOut() {
    token = null; user = null;
    store.del('auth');
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    emitAuth();
  }

  // Renew the session in the background when it is older than a few days (or swap an old Google token for one).
  const RENEW_BEFORE = 50 * 86400000;
  function renewSession() {
    if (!tokenValid()) return;
    if (isSession(token) && tokenExp(token) - Date.now() > RENEW_BEFORE) return;
    call('me').then(u => {
      if (user && u.id === user.id) acceptMe(u); // quietly: no "Hi" toast, no reload
    }).catch(() => {});
  }

  function restore() {
    const saved = store.get('auth', null);
    if (saved && saved.user) { token = saved.token; user = saved.user; }
    if (CONFIGURED && user) renewSession();
    if (CONFIGURED) {
      takeRedirectResult();
      if (!useRedirect()) loadGis().catch(() => {});
    }
  }

  function photoUrl(id, size = 800) {
    if (!id) return '';
    if (id.startsWith('data:')) return id;
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${size}`;
  }

  window.API = {
    CONFIGURED, call, onAuth, restore, signOut, renderSignInButton, ensureSignedIn, photoUrl, store,
    useRedirect, signInRedirect,
    get user() { return user; },
    // real role; isAdmin is false while a moderator has "user mode" on (to test what regular users see)
    get isModerator() { return !!user && user.role === 'admin'; },
    get userMode() { try { return localStorage.getItem('user_mode') === '1'; } catch (e) { return false; } },
    get isAdmin() { return this.isModerator && !this.userMode; },
    setUser(fields) {
      if (!user) return;
      Object.assign(user, fields);
      store.set('auth', { token, user });
    },
    setUserName(name) {
      if (!user) return;
      user.name = name;
      store.set('auth', { token, user });
    },
  };
})();
