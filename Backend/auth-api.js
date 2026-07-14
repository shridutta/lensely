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

const JWT_SECRET  = process.env.JWT_SECRET  || 'lensly-dev-secret-CHANGE-IN-PRODUCTION';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES }); }
function verifyToken(token)  { return jwt.verify(token, JWT_SECRET); }

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

  console.log('  Auth: /api/auth/photographer/login · /register · /change-password · /logout · /me');
}

module.exports = { init, requireAuth, signToken, verifyToken };
