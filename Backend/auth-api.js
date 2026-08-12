// ═══════════════════════════════════════════════════════════════
//  auth-api.js — Authentication routes for Lensly
//  Custom JWT + bcrypt, backed by Supabase Postgres (via db.js).
//
//  Wire into server.js:
//     const auth = require('./auth-api');
//     auth.init(app, db);
//
//  ENV (see .env.example):
//     JWT_SECRET=...            (required in production)
//     JWT_EXPIRES_IN=7d
// ═══════════════════════════════════════════════════════════════

const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const notify = require('./notify');

const JWT_SECRET  = process.env.JWT_SECRET  || 'lensly-dev-secret-CHANGE-IN-PRODUCTION';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES }); }
function verifyToken(token)  { return jwt.verify(token, JWT_SECRET); }

// ── OTP tuning ────────────────────────────────────────────────
const OTP_TTL_SECONDS    = 5 * 60;   // code valid for 5 minutes
const OTP_MAX_ATTEMPTS   = 5;        // wrong-code attempts before the code is dead
const OTP_RATE_WINDOW    = 10 * 60;  // rate-limit window
const OTP_RATE_MAX       = 3;        // max codes requested per window
const OTP_COOLDOWN_SECS  = 45;       // minimum gap between two requests

function genOtpCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function normalizeOtpTarget(channel, raw) {
  return channel === 'email' ? String(raw || '').trim().toLowerCase() : String(raw || '').replace(/\s+/g, '');
}

// ── Admin PIN lockout (server-side, defense-in-depth alongside the
//    client's own localStorage cooldown) — 3 wrong attempts / 5 min,
//    tracked per-IP in memory. Resets on redeploy; that's fine for a
//    lightweight gate on a low-stakes internal tool. ────────────────
const ADMIN_PIN_MAX_ATTEMPTS = 3;
const ADMIN_PIN_COOLDOWN_MS  = 5 * 60 * 1000;
const adminPinAttempts = new Map(); // ip -> { attempts, lockedUntil }
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown'; }

// ── Middleware — protect routes ─────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: 'Not logged in. Please sign in.' });
  try { req.user = verifyToken(token); next(); }
  catch (err) { return res.status(401).json({ success: false, error: 'Session expired. Please sign in again.' }); }
}

// ── init(app, db) ───────────────────────────────────────────────
function init(app, db) {

  // POST /api/auth/photographer/register  — admin: set a password
  // Body: { photographer_id, password }
  app.post('/api/auth/photographer/register', async (req, res) => {
    try {
      const { photographer_id, password } = req.body;
      if (!photographer_id || !password)
        return res.status(400).json({ success: false, error: 'photographer_id and password required' });

      const phot = await db.getPhotographerById(photographer_id);
      if (!phot) return res.status(404).json({ success: false, error: 'Photographer not found' });

      const password_hash = await bcrypt.hash(password, 10);
      await db.updatePhotographer(photographer_id, { password_hash });
      res.json({ success: true, message: `Password set for ${phot.name}. They can now log in.` });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/auth/photographer/signup — Lensly X self-registration
  // Body: { name, email, password, emailVerificationToken, service_type?, city?, phone?, specialty?, half_day_rate?, full_day_rate? }
  // emailVerificationToken comes from POST /api/auth/otp/verify with
  // role:'photographer_signup' — proves the applicant owns this email
  // before an account is created (real onboarding, not just a form post).
  app.post('/api/auth/photographer/signup', async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name || !b.email || !b.password)
        return res.status(400).json({ success: false, error: 'name, email and password are required' });
      if (String(b.password).length < 8)
        return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
      if (!b.emailVerificationToken)
        return res.status(400).json({ success: false, error: 'Please verify your email first.' });

      let claim;
      try { claim = jwt.verify(b.emailVerificationToken, JWT_SECRET); }
      catch { return res.status(400).json({ success: false, error: 'Email verification expired. Please verify your email again.' }); }
      if (claim.purpose !== 'photographer_signup' || claim.email !== String(b.email).trim().toLowerCase())
        return res.status(400).json({ success: false, error: 'Email verification does not match this address. Please verify again.' });

      const existing = await db.getPhotographerByEmail(b.email);
      if (existing) return res.status(409).json({ success: false, error: 'An account with this email already exists' });

      const created = await db.createPhotographer(b);
      await db.updatePhotographer(created.id, { password_hash: await bcrypt.hash(b.password, 10) });

      const token = signToken({ id: created.id, name: created.name, email: created.email, service_type: created.service_type, role: 'photographer' });
      res.status(201).json({ success: true, token, expires_in: JWT_EXPIRES, photographer: created });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/auth/photographer/login   Body: { email, password }
  app.post('/api/auth/photographer/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ success: false, error: 'Email and password required' });

      const phot = await db.getPhotographerByEmail(email);
      if (!phot)               return res.status(401).json({ success: false, error: 'Invalid email or password' });
      if (!phot.password_hash) return res.status(401).json({ success: false, error: 'Account not yet activated. Contact admin.' });

      const valid = await bcrypt.compare(password, phot.password_hash);
      if (!valid)                    return res.status(401).json({ success: false, error: 'Invalid email or password' });
      if (phot.status !== 'Active')  return res.status(403).json({ success: false, error: 'Account is not active. Contact admin.' });

      const token = signToken({ id: phot.id, name: phot.name, email: phot.email, service_type: phot.service_type, role: 'photographer' });
      const { password_hash, ...safePhot } = phot;
      res.json({ success: true, token, expires_in: JWT_EXPIRES, photographer: safePhot });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/auth/otp/request — send a real 6-digit code by email or WhatsApp
  // Body: { channel: 'email'|'mobile', email?, phone?, role }
  //   role: 'guest' | 'customer' | 'photographer' | 'photographer_signup'
  app.post('/api/auth/otp/request', async (req, res) => {
    try {
      const { channel, email, phone, role } = req.body || {};
      if (!['email', 'mobile'].includes(channel))
        return res.status(400).json({ success: false, error: 'Invalid channel' });
      const purpose = role || 'guest';
      const raw = channel === 'email' ? email : phone;
      if (!raw) return res.status(400).json({ success: false, error: channel === 'email' ? 'Email is required' : 'Phone number is required' });
      const target = normalizeOtpTarget(channel, raw);

      const recentCount = await db.countRecentOtp(channel, target, purpose, OTP_RATE_WINDOW);
      if (recentCount >= OTP_RATE_MAX)
        return res.status(429).json({ success: false, error: 'Too many code requests. Please try again in a few minutes.' });

      const last = await db.getMostRecentOtpRequest(channel, target, purpose);
      if (last && (Date.now() - new Date(last.created_at).getTime()) < OTP_COOLDOWN_SECS * 1000)
        return res.status(429).json({ success: false, error: 'Please wait a moment before requesting another code.' });

      const code     = genOtpCode();
      const codeHash = await bcrypt.hash(code, 8);
      const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();
      await db.createOtpCode({ channel, target, purpose, codeHash, expiresAt });

      const message = `Your Lensly verification code is ${code}. It expires in 5 minutes. Do not share this code with anyone.`;
      if (channel === 'email') await notify.sendEmail(target, 'Your Lensly verification code', message);
      else                     await notify.sendWhatsApp(target, message);

      res.json({ success: true, sent: true, expires_in: OTP_TTL_SECONDS });
    } catch (err) {
      // Delivery failures (unconfigured provider, network, etc.) → 503, no code ever leaks to the client
      res.status(503).json({ success: false, error: err.message || 'Could not send the verification code. Please try again shortly.' });
    }
  });

  // POST /api/auth/otp/verify — check the code actually matches (bcrypt-compared, single-use)
  // Body: { channel, email?, phone?, code, role }
  app.post('/api/auth/otp/verify', async (req, res) => {
    try {
      const { channel, email, phone, code, role } = req.body || {};
      if (!['email', 'mobile'].includes(channel))
        return res.status(400).json({ success: false, error: 'Invalid channel' });
      const purpose = role || 'guest';
      const raw = channel === 'email' ? email : phone;
      if (!raw || !code) return res.status(400).json({ success: false, error: 'Missing code or contact detail' });
      const target = normalizeOtpTarget(channel, raw);

      const row = await db.getLatestOtp(channel, target, purpose);
      if (!row) return res.status(400).json({ success: false, error: 'No active code found. Please request a new one.' });
      if (new Date(row.expires_at).getTime() < Date.now())
        return res.status(400).json({ success: false, error: 'This code has expired. Please request a new one.' });
      if (row.attempts >= OTP_MAX_ATTEMPTS)
        return res.status(429).json({ success: false, error: 'Too many incorrect attempts. Please request a new code.' });

      const ok = await bcrypt.compare(String(code).trim(), row.code_hash);
      if (!ok) {
        await db.incrementOtpAttempts(row.id, row.attempts);
        return res.status(401).json({ success: false, error: 'Incorrect code. Please try again.' });
      }
      await db.markOtpConsumed(row.id);

      // Verifying an email to activate a NEW photographer account — issue a
      // short-lived token that /signup checks, so accounts always require
      // proof of email ownership first.
      if (purpose === 'photographer_signup') {
        const emailVerificationToken = jwt.sign({ email: target, purpose: 'photographer_signup' }, JWT_SECRET, { expiresIn: '15m' });
        return res.json({ success: true, verified: true, emailVerificationToken });
      }

      // Logging in to an EXISTING photographer account via OTP instead of a password
      if (purpose === 'photographer') {
        const phot = channel === 'email' ? await db.getPhotographerByEmail(target) : await db.getPhotographerByPhone(target);
        if (!phot) return res.status(404).json({ success: false, error: 'No photographer account found for this ' + (channel === 'email' ? 'email' : 'number') + '. Please sign up first.' });
        if (phot.status !== 'Active') return res.status(403).json({ success: false, error: 'Account is not active. Contact admin.' });
        const token = signToken({ id: phot.id, name: phot.name, email: phot.email, service_type: phot.service_type, role: 'photographer' });
        const { password_hash, ...safePhot } = phot;
        return res.json({ success: true, token, expires_in: JWT_EXPIRES, photographer: safePhot });
      }

      // Guest / customer — this only proves ownership of the email or phone.
      // There's no customer accounts table yet, so no token is issued.
      res.json({ success: true, verified: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/auth/admin/pin/verify — gate for the global "Take Booking" tool.
  // Body: { pin }. On success, issues a short-lived admin JWT (2h) that the
  // frontend uses to auto-accept a booking it records on a photographer's
  // behalf. The PIN itself lives in Supabase (public.admins, is_admin=true),
  // bcrypt-hashed — see supabase/users-schema.sql to seed/rotate it.
  app.post('/api/auth/admin/pin/verify', async (req, res) => {
    try {
      const ip = clientIp(req);
      const entry = adminPinAttempts.get(ip);
      if (entry && entry.lockedUntil && Date.now() < entry.lockedUntil) {
        const secs = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
        return res.status(429).json({ success: false, error: `Too many wrong attempts. Try again in ${Math.ceil(secs / 60)} minute(s).` });
      }

      const { pin } = req.body || {};
      if (!pin) return res.status(400).json({ success: false, error: 'PIN is required' });

      const admins = await db.listActiveAdmins();
      for (const a of admins) {
        if (await bcrypt.compare(String(pin).trim(), a.pin_hash)) {
          adminPinAttempts.delete(ip);
          const token = jwt.sign({ id: a.id, name: a.name, role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
          return res.json({ success: true, token, expires_in: '2h', admin: { id: a.id, name: a.name } });
        }
      }

      const attempts = (entry?.attempts || 0) + 1;
      if (attempts >= ADMIN_PIN_MAX_ATTEMPTS) {
        adminPinAttempts.set(ip, { attempts: 0, lockedUntil: Date.now() + ADMIN_PIN_COOLDOWN_MS });
        return res.status(429).json({ success: false, error: 'Too many wrong attempts. Try again in 5 minutes.' });
      }
      adminPinAttempts.set(ip, { attempts, lockedUntil: null });
      res.status(401).json({ success: false, error: 'Incorrect PIN.' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/auth/admin/pin/change — rotate the PIN without a redeploy.
  // Bearer admin token (from /verify above). Body: { current_pin, new_pin }
  app.post('/api/auth/admin/pin/change', requireAuth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
      const { current_pin, new_pin } = req.body || {};
      if (!current_pin || !new_pin) return res.status(400).json({ success: false, error: 'Both the current and new PIN are required' });
      if (!/^\d{6}$/.test(String(new_pin))) return res.status(400).json({ success: false, error: 'New PIN must be exactly 6 digits' });

      const admin = await db.getAdminById(req.user.id);
      if (!admin) return res.status(404).json({ success: false, error: 'Admin not found' });
      const ok = await bcrypt.compare(String(current_pin).trim(), admin.pin_hash);
      if (!ok) return res.status(401).json({ success: false, error: 'Current PIN is incorrect' });

      await db.updateAdminPinHash(admin.id, await bcrypt.hash(String(new_pin).trim(), 10));
      res.json({ success: true, message: 'PIN updated.' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/auth/logout  (stateless — client drops the token)
  app.post('/api/auth/logout', (req, res) =>
    res.json({ success: true, message: 'Logged out. Please remove your token from local storage.' }));

  // GET /api/auth/me  (requires token)
  app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
      const phot = await db.getPhotographerById(req.user.id);
      if (!phot) return res.status(404).json({ success: false, error: 'Account not found' });
      const { password_hash, ...safePhot } = phot;
      res.json({ success: true, photographer: safePhot });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/auth/photographer/change-password  Body: { current_password, new_password }
  app.post('/api/auth/photographer/change-password', requireAuth, async (req, res) => {
    try {
      const { current_password, new_password } = req.body;
      if (!current_password || !new_password)
        return res.status(400).json({ success: false, error: 'Both passwords required' });
      if (new_password.length < 8)
        return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });

      const phot = await db.getPhotographerById(req.user.id);
      if (!phot) return res.status(404).json({ success: false, error: 'Account not found' });

      const valid = await bcrypt.compare(current_password, phot.password_hash || '');
      if (!valid) return res.status(401).json({ success: false, error: 'Current password is incorrect' });

      await db.updatePhotographer(req.user.id, { password_hash: await bcrypt.hash(new_password, 10) });
      res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  console.log('  Auth: /api/auth/photographer/login · /signup · /register · /change-password · /logout · /me');
  console.log('  OTP:  /api/auth/otp/request · /verify (real email + WhatsApp delivery — see notify.js)');
  console.log('  Admin PIN: /api/auth/admin/pin/verify · /change (see supabase/users-schema.sql)');
}

module.exports = { init, requireAuth, signToken, verifyToken };
