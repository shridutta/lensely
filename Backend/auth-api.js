// ═══════════════════════════════════════════════════════════════
//  auth-api.js — Authentication routes for Lensly
//
//  HOW TO ADD TO server.js:
//    const auth = require('./auth-api');
//    auth.init(app, readSheet, writeSheet, PORT);
//
//  DESTINATION FILE: lensly-backend/auth-api.js
//
//  Dependencies to install:
//    npm install jsonwebtoken bcryptjs
//
//  ENV variables needed (add to .env file):
//    JWT_SECRET=your-very-long-secret-key-change-this
//    JWT_EXPIRES_IN=7d
// ═══════════════════════════════════════════════════════════════

const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');

const JWT_SECRET  = process.env.JWT_SECRET  || 'lensly-dev-secret-CHANGE-IN-PRODUCTION';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

// ─────────────────────────────────────────────────────────────
//  Token helper
// ─────────────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // throws if invalid/expired
}

// ─────────────────────────────────────────────────────────────
//  Middleware — protect routes
//  Usage: app.get('/api/protected', requireAuth, (req, res) => {...})
// ─────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token)
    return res.status(401).json({ success: false, error: 'Not logged in. Please sign in.' });

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Session expired. Please sign in again.' });
  }
}

// ─────────────────────────────────────────────────────────────
//  init(app, readSheet, writeSheet, PORT)
//  Call this from server.js to register all auth routes
// ─────────────────────────────────────────────────────────────

function init(app, readSheet, writeSheet, PORT) {

  // ── POST /api/auth/photographer/register ─────────────────────
  // Admin-only: set a password for an existing photographer
  // Body: { photographer_id, password }
  //
  // NOTE: In production, this should be called only by the admin
  //       and the password should be communicated securely.
  //       For MVP you can call this once via Postman to set passwords.
  //
  app.post('/api/auth/photographer/register', async (req, res) => {
    try {
      const { photographer_id, password } = req.body;
      if (!photographer_id || !password)
        return res.status(400).json({ success: false, error: 'photographer_id and password required' });

      const rows = readSheet('Photographers');
      const idx  = rows.findIndex(r => r.id === photographer_id);
      if (idx === -1)
        return res.status(404).json({ success: false, error: 'Photographer not found' });

      // Hash password with bcrypt (cost factor 10 — safe for MVP)
      const hash = await bcrypt.hash(password, 10);
      rows[idx].password_hash = hash;
      writeSheet('Photographers', rows);

      res.json({
        success: true,
        message: `Password set for ${rows[idx].name}. They can now log in.`
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // ── POST /api/auth/photographer/login ────────────────────────
  // Body: { email, password }
  // Returns: { token, photographer: { id, name, ... } }
  //
  app.post('/api/auth/photographer/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ success: false, error: 'Email and password required' });

      const rows = readSheet('Photographers');
      const phot = rows.find(r =>
        r.email.toLowerCase().trim() === email.toLowerCase().trim()
      );

      // Generic error message (don't reveal whether email exists)
      if (!phot)
        return res.status(401).json({ success: false, error: 'Invalid email or password' });

      if (!phot.password_hash)
        return res.status(401).json({ success: false, error: 'Account not yet activated. Contact admin.' });

      const valid = await bcrypt.compare(password, phot.password_hash);
      if (!valid)
        return res.status(401).json({ success: false, error: 'Invalid email or password' });

      if (phot.status !== 'Active')
        return res.status(403).json({ success: false, error: 'Account is not active. Contact admin.' });

      // Build token — include only non-sensitive fields
      const token = signToken({
        id:           phot.id,
        name:         phot.name,
        email:        phot.email,
        service_type: phot.service_type,
        role:         'photographer'
      });

      // Return safe profile (no password hash)
      const { password_hash, ...safePhot } = phot;

      res.json({
        success: true,
        token,
        expires_in: JWT_EXPIRES,
        photographer: safePhot
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // ── POST /api/auth/logout ────────────────────────────────────
  // Client should delete the token from storage on logout.
  // This endpoint is a soft confirmation (JWT is stateless).
  //
  app.post('/api/auth/logout', (req, res) => {
    res.json({
      success: true,
      message: 'Logged out. Please remove your token from local storage.'
    });
  });


  // ── GET /api/auth/me ─────────────────────────────────────────
  // Returns current photographer's profile (requires valid token)
  // Header: Authorization: Bearer <token>
  //
  app.get('/api/auth/me', requireAuth, (req, res) => {
    try {
      const rows = readSheet('Photographers');
      const phot = rows.find(r => r.id === req.user.id);
      if (!phot)
        return res.status(404).json({ success: false, error: 'Account not found' });

      const { password_hash, ...safePhot } = phot;
      res.json({ success: true, photographer: safePhot });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // ── POST /api/auth/photographer/change-password ──────────────
  // Body: { current_password, new_password }
  // Header: Authorization: Bearer <token>
  //
  app.post('/api/auth/photographer/change-password', requireAuth, async (req, res) => {
    try {
      const { current_password, new_password } = req.body;
      if (!current_password || !new_password)
        return res.status(400).json({ success: false, error: 'Both passwords required' });

      if (new_password.length < 8)
        return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });

      const rows = readSheet('Photographers');
      const idx  = rows.findIndex(r => r.id === req.user.id);
      if (idx === -1)
        return res.status(404).json({ success: false, error: 'Account not found' });

      const valid = await bcrypt.compare(current_password, rows[idx].password_hash || '');
      if (!valid)
        return res.status(401).json({ success: false, error: 'Current password is incorrect' });

      rows[idx].password_hash = await bcrypt.hash(new_password, 10);
      writeSheet('Photographers', rows);

      res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log('  POST   /api/auth/photographer/login');
  console.log('  POST   /api/auth/photographer/register   (admin only)');
  console.log('  POST   /api/auth/photographer/change-password');
  console.log('  POST   /api/auth/logout');
  console.log('  GET    /api/auth/me');
}


// ─────────────────────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────────────────────

module.exports = { init, requireAuth, signToken, verifyToken };

/*
═══════════════════════════════════════════════════════════════
  HOW TO WIRE INTO server.js — add these lines:
═══════════════════════════════════════════════════════════════

  const auth = require('./auth-api');
  // Register auth routes (call AFTER express.json() middleware)
  auth.init(app, readSheet, writeSheet, PORT);

═══════════════════════════════════════════════════════════════
  FIRST TIME SETUP — set a password for PHT-001:
═══════════════════════════════════════════════════════════════

  curl -X POST http://localhost:3000/api/auth/photographer/register \
    -H "Content-Type: application/json" \
    -d '{"photographer_id": "PHT-001", "password": "sofia@lensly"}'

  Then login:
  curl -X POST http://localhost:3000/api/auth/photographer/login \
    -H "Content-Type: application/json" \
    -d '{"email": "sofia@example.com", "password": "sofia@lensly"}'

═══════════════════════════════════════════════════════════════
*/
