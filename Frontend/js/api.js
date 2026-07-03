/* ═══════════════════════════════════════════════════════════════
   Lensly — Frontend API client  (shared by every page)
   ---------------------------------------------------------------
   All calls go to the Lensly backend (Express + Excel).

   BACKEND DESTINATION FILES:
     • Auth routes      →  Backend/auth-api.js
                           (login / logout / me / change-password)
     • Everything else  →  Backend/server.js
                           (photographers, avatar, portfolio, bookings)

   The base URL defaults to http://localhost:3000 and can be
   overridden at runtime:  localStorage.lensly_api_base = 'https://...'

   Every method returns a Promise. When the backend is offline
   (e.g. parked during design work) calls reject — callers are
   expected to catch and fall back to the static demo UI.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const API_BASE = (function () {
    try { return localStorage.getItem('lensly_api_base'); } catch (e) { return null; }
  })() || 'http://localhost:3000';

  const BASE      = API_BASE.replace(/\/+$/, '');
  const TOKEN_KEY = 'lensly_token';
  const PHOT_KEY  = 'lensly_photographer';   // logged-in photographer profile (JSON)

  /* ── Session helpers ─────────────────────────────────────────── */
  function token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setSession(tok, phot) {
    try {
      if (tok)  localStorage.setItem(TOKEN_KEY, tok);
      if (phot) localStorage.setItem(PHOT_KEY, JSON.stringify(phot));
    } catch (e) {}
  }
  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PHOT_KEY);
    } catch (e) {}
  }
  function currentPhotographer() {
    try { return JSON.parse(localStorage.getItem(PHOT_KEY) || 'null'); } catch (e) { return null; }
  }
  function isLoggedIn() { return !!token(); }

  /* Absolute URL for an image path returned by the backend */
  function assetUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return BASE + '/' + String(pathOrUrl).replace(/^\/+/, '');
  }

  /* ── Core request wrapper ────────────────────────────────────── */
  async function request(path, opts) {
    opts = opts || {};
    const headers = {};
    const isForm  = opts.isForm === true;               // FormData → let browser set Content-Type
    if (!isForm && opts.body != null) headers['Content-Type'] = 'application/json';
    if (opts.auth && token()) headers['Authorization'] = 'Bearer ' + token();

    let res;
    try {
      res = await fetch(BASE + path, {
        method:  opts.method || 'GET',
        headers: headers,
        body:    isForm ? opts.body : (opts.body != null ? JSON.stringify(opts.body) : undefined)
      });
    } catch (networkErr) {
      // Backend unreachable (offline / parked)
      const e = new Error('Cannot reach the Lensly server. Is the backend running?');
      e.offline = true;
      throw e;
    }

    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON response */ }

    if (res.status === 401) clearSession();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || ('Request failed (' + res.status + ')'));
    }
    return data;
  }

  /* ── AUTH ──  Backend/auth-api.js ────────────────────────────── */

  // POST /api/auth/photographer/login  →  { token, photographer }
  async function login(email, password) {
    const data = await request('/api/auth/photographer/login', {
      method: 'POST', body: { email: email, password: password }
    });
    setSession(data.token, data.photographer);
    return data;
  }

  // GET /api/auth/me  (requires token)
  function me() { return request('/api/auth/me', { auth: true }); }

  // POST /api/auth/logout  (JWT is stateless — we just drop the token)
  async function logout() {
    try { await request('/api/auth/logout', { method: 'POST', auth: true }); }
    catch (e) { /* ignore */ }
    finally { clearSession(); }
  }

  /* ── PHOTOGRAPHERS ──  Backend/server.js ─────────────────────── */

  function listPhotographers(params) {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return request('/api/photographers' + q);
  }
  function getPhotographer(id) { return request('/api/photographers/' + id); }

  // POST /api/photographers/:id/avatar   (field name: "avatar")
  function uploadAvatar(id, file) {
    const fd = new FormData();
    fd.append('avatar', file);
    return request('/api/photographers/' + id + '/avatar', { method: 'POST', body: fd, isForm: true, auth: true });
  }

  function getPortfolio(id) { return request('/api/photographers/' + id + '/portfolio'); }

  // POST /api/photographers/:id/portfolio   (field name: "images", up to 10)
  function uploadPortfolio(id, files) {
    const fd = new FormData();
    Array.prototype.forEach.call(files, function (f) { fd.append('images', f); });
    return request('/api/photographers/' + id + '/portfolio', { method: 'POST', body: fd, isForm: true, auth: true });
  }

  function deletePortfolioImage(id, filename) {
    return request('/api/photographers/' + id + '/portfolio/' + filename, { method: 'DELETE', auth: true });
  }

  /* ── BOOKINGS ──  Backend/server.js ──────────────────────────── */

  function listBookings(params) {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return request('/api/bookings' + q);
  }

  // POST /api/bookings  — customer books a slot with a photographer
  function createBooking(payload) {
    return request('/api/bookings', { method: 'POST', body: payload });
  }

  function acceptBooking(id) { return request('/api/bookings/' + id + '/accept', { method: 'PATCH', auth: true }); }
  function rejectBooking(id, reason) {
    return request('/api/bookings/' + id + '/reject', { method: 'PATCH', auth: true, body: { reason: reason || '' } });
  }

  /* ── Health check — true if backend answers ──────────────────── */
  async function ping() {
    try { await request('/api/summary'); return true; } catch (e) { return false; }
  }

  /* ── Export ──────────────────────────────────────────────────── */
  global.LenslyAPI = {
    BASE: BASE,
    // session
    token: token, isLoggedIn: isLoggedIn, currentPhotographer: currentPhotographer,
    clearSession: clearSession, setSession: setSession, assetUrl: assetUrl,
    // auth
    login: login, logout: logout, me: me,
    // photographers
    listPhotographers: listPhotographers, getPhotographer: getPhotographer,
    uploadAvatar: uploadAvatar, getPortfolio: getPortfolio,
    uploadPortfolio: uploadPortfolio, deletePortfolioImage: deletePortfolioImage,
    // bookings
    listBookings: listBookings, createBooking: createBooking,
    acceptBooking: acceptBooking, rejectBooking: rejectBooking,
    // misc
    ping: ping
  };
})(window);
