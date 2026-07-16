// ═══════════════════════════════════════════════════════════════
//  Lensly — API server (Supabase edition)
//  • Data    → Supabase Postgres          (see db.js + supabase/schema.sql)
//  • Images  → Supabase Storage buckets    (avatars, portfolio)
//  • Auth    → custom JWT + bcrypt          (see auth-api.js)
//  Deploy    → Render (see render.yaml)
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');

const db   = require('./db');           // Supabase data + storage layer
const auth = require('./auth-api');      // JWT/bcrypt auth routes

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Multer keeps files in memory only — we stream the buffer straight
// to Supabase Storage, nothing ever touches local disk.
function imageFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  cb(allowed.includes(file.mimetype) ? null : new Error('Only JPG, PNG and WEBP images are allowed'),
     allowed.includes(file.mimetype));
}
const avatarUpload    = multer({ storage: multer.memoryStorage(), fileFilter: imageFilter, limits: { fileSize: 5  * 1024 * 1024 } });
const portfolioUpload = multer({ storage: multer.memoryStorage(), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });

function extOf(filename) {
  const e = path.extname(filename || '').toLowerCase();
  return e || '.jpg';
}

// ── Health check (used by Render) ───────────────────────────────
app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok', time: db.nowIso() }));

// ── Auth routes (JWT/bcrypt, backed by Postgres) ────────────────
auth.init(app, db);
const { requireAuth } = auth;

// ═══════════════════════════════════════════════════════════════
//  IMAGE ROUTES  (Supabase Storage)
// ═══════════════════════════════════════════════════════════════

// POST /api/photographers/:id/avatar   (field: "avatar")
app.post('/api/photographers/:id/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file received' });
    const phot = await db.getPhotographerById(req.params.id);
    if (!phot) return res.status(404).json({ success: false, error: 'Photographer not found' });

    const objectPath = `${req.params.id}${extOf(req.file.originalname)}`;
    const { url } = await db.uploadToBucket(db.AVATAR_BUCKET, objectPath, req.file.buffer, req.file.mimetype);
    await db.updatePhotographer(req.params.id, { avatar_url: url });

    res.json({ success: true, message: 'Avatar uploaded', avatar_path: objectPath, url });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/photographers/:id/avatar
app.get('/api/photographers/:id/avatar', async (req, res) => {
  try {
    const phot = await db.getPhotographerById(req.params.id);
    if (!phot) return res.status(404).json({ success: false, error: 'Photographer not found' });
    res.json({ success: true, has_avatar: !!phot.avatar_url, url: phot.avatar_url || null });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/photographers/:id/avatar
app.delete('/api/photographers/:id/avatar', requireAuth, async (req, res) => {
  try {
    const phot = await db.getPhotographerById(req.params.id);
    if (!phot) return res.status(404).json({ success: false, error: 'Not found' });
    if (phot.avatar_url) {
      const objectPath = phot.avatar_url.split(`/${db.AVATAR_BUCKET}/`).pop();
      await db.removeFromBucket(db.AVATAR_BUCKET, objectPath).catch(() => {});
    }
    await db.updatePhotographer(req.params.id, { avatar_url: null });
    res.json({ success: true, message: 'Avatar removed' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/photographers/:id/portfolio   (field: "images", up to 10)
app.post('/api/photographers/:id/portfolio', requireAuth, portfolioUpload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ success: false, error: 'No images received' });
    const phot = await db.getPhotographerById(req.params.id);
    if (!phot) return res.status(404).json({ success: false, error: 'Photographer not found' });

    const uploaded = [];
    for (const f of req.files) {
      const objectPath = `${req.params.id}/${Date.now()}-${Math.round(Math.random() * 1e6)}${extOf(f.originalname)}`;
      uploaded.push(await db.uploadToBucket(db.PORTFOLIO_BUCKET, objectPath, f.buffer, f.mimetype));
    }
    await db.addPortfolioImages(req.params.id, uploaded);
    const all = await db.listPortfolio(req.params.id);

    res.json({ success: true, message: `${uploaded.length} image(s) uploaded`, uploaded, total_portfolio: all.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/photographers/:id/portfolio
app.get('/api/photographers/:id/portfolio', async (req, res) => {
  try {
    const images = await db.listPortfolio(req.params.id);
    res.json({
      success: true, count: images.length,
      images: images.map(im => ({ path: im.path, filename: im.path.split('/').pop(), url: im.url }))
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/photographers/:id/portfolio/:filename
app.delete('/api/photographers/:id/portfolio/:filename', requireAuth, async (req, res) => {
  try {
    const objectPath = `${req.params.id}/${req.params.filename}`;
    await db.removeFromBucket(db.PORTFOLIO_BUCKET, objectPath).catch(() => {});
    const remaining = await db.deletePortfolioImageByPath(req.params.id, objectPath);
    const all = await db.listPortfolio(req.params.id);
    res.json({ success: true, message: 'Image deleted', deleted: remaining.length, remaining: all.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/photographers/:id/portfolio   (clear all)
app.delete('/api/photographers/:id/portfolio', requireAuth, async (req, res) => {
  try {
    const rows = await db.listPortfolio(req.params.id);
    if (rows.length) await db.removeFromBucket(db.PORTFOLIO_BUCKET, rows.map(r => r.path)).catch(() => {});
    await db.clearPortfolio(req.params.id);
    res.json({ success: true, message: 'All portfolio images cleared' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  PHOTOGRAPHER ROUTES
// ═══════════════════════════════════════════════════════════════
app.get('/api/photographers', async (req, res) => {
  try {
    const rows = await db.listPhotographers({
      status: req.query.status, service_type: req.query.service_type, city: req.query.city
    });
    const clean = rows.map(({ password_hash, ...r }) => r);   // never leak hashes
    res.json({ success: true, count: clean.length, data: clean });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/photographers/:id', async (req, res) => {
  try {
    const phot = await db.getPhotographerById(req.params.id);
    if (!phot) return res.status(404).json({ success: false, error: 'Not found' });
    const portfolio = await db.listPortfolio(req.params.id);
    const { password_hash, ...safe } = phot;
    res.json({ success: true, data: { ...safe, portfolio_urls: portfolio.map(p => p.url) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/photographers', async (req, res) => {
  try {
    const { password_hash, ...created } = await db.createPhotographer(req.body);
    res.status(201).json({ success: true, data: created });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.patch('/api/photographers/:id', requireAuth, async (req, res) => {
  try {
    const { password_hash, id, ...patch } = req.body;   // guard sensitive columns
    const row = await db.updatePhotographer(req.params.id, patch);
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    const { password_hash: _ph, ...safe } = row;
    res.json({ success: true, data: safe });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/photographers/:id', requireAuth, async (req, res) => {
  try {
    const ok = await db.deletePhotographer(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  BOOKING ROUTES
// ═══════════════════════════════════════════════════════════════
app.get('/api/bookings', async (req, res) => {
  try {
    const rows = await db.listBookings({ photographer_id: req.query.photographer_id, status: req.query.status, client_phone: req.query.client_phone });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/bookings/:id', async (req, res) => {
  try {
    const bkg = await db.getBookingById(req.params.id);
    if (!bkg) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: bkg });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Customer books a slot — public (no auth); client identified by the form
app.post('/api/bookings', async (req, res) => {
  try {
    const bkg = await db.createBooking(req.body);
    res.status(201).json({ success: true, data: bkg });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.patch('/api/bookings/:id/accept', requireAuth, async (req, res) => {
  try {
    const bkg = await db.getBookingById(req.params.id);
    if (!bkg) return res.status(404).json({ success: false, error: 'Not found' });
    if (bkg.status !== 'Pending') return res.status(400).json({ success: false, error: `Already ${bkg.status}` });
    const row = await db.updateBooking(req.params.id, { status: 'Accepted', responded_on: db.nowIso() });
    res.json({ success: true, message: 'Booking accepted', data: row });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.patch('/api/bookings/:id/reject', requireAuth, async (req, res) => {
  try {
    const bkg = await db.getBookingById(req.params.id);
    if (!bkg) return res.status(404).json({ success: false, error: 'Not found' });
    if (bkg.status !== 'Pending') return res.status(400).json({ success: false, error: `Already ${bkg.status}` });
    const patch = { status: 'Rejected', responded_on: db.nowIso() };
    if (req.body && req.body.reason) patch.notes = req.body.reason;
    const row = await db.updateBooking(req.params.id, patch);
    res.json({ success: true, message: 'Booking rejected', data: row });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.patch('/api/bookings/:id/complete', requireAuth, async (req, res) => {
  try {
    const row = await db.updateBooking(req.params.id, { status: 'Completed' });
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: row });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/summary', async (req, res) => {
  try {
    const photographers = await db.listPhotographers();
    const bookings      = await db.listBookings();
    const count = (s) => bookings.filter(b => b.status === s).length;
    const revenue = bookings.filter(b => b.status !== 'Rejected' && b.status !== 'Pending')
                            .reduce((s, b) => s + (Number(b.amount) || 0), 0);
    res.json({
      success: true,
      data: {
        photographers: { total: photographers.length, active: photographers.filter(p => p.status === 'Active').length },
        bookings: { pending: count('Pending'), accepted: count('Accepted'), completed: count('Completed'), rejected: count('Rejected'), total: bookings.length },
        revenue: { total: revenue, formatted: '₹' + revenue.toLocaleString('en-IN') }
      }
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Error handler (multer + fallthrough) ────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ success: false, error: 'File too large. Max 5 MB avatar, 10 MB portfolio.' });
  res.status(400).json({ success: false, error: err.message });
});

// ── Start ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Lensly API (Supabase) running on http://localhost:${PORT}`);
  console.log(`  Health: /api/health\n`);
});
