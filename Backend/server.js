// ═══════════════════════════════════════════════════════════════
//  Lensly — Excel-as-database backend server
//  Runs on http://localhost:3000
//  Data:   ./data/lensly.xlsx
//  Images: ./uploads/avatars/    ← profile photos
//          ./uploads/portfolio/  ← portfolio samples
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const XLSX    = require('xlsx');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3000;

// ── Paths ──────────────────────────────────────────────────────
const DATA_DIR      = path.join(__dirname, 'data');
const FILE_PATH     = path.join(DATA_DIR, 'lensly.xlsx');
const UPLOADS_DIR   = path.join(__dirname, 'uploads');
const AVATARS_DIR   = path.join(UPLOADS_DIR, 'avatars');
const PORTFOLIO_DIR = path.join(UPLOADS_DIR, 'portfolio');

// Ensure folders exist
[DATA_DIR, AVATARS_DIR, PORTFOLIO_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Middleware ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve uploaded images as static files
// e.g. http://localhost:3000/uploads/avatars/PHT-001.jpg
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve frontend HTML from ./public
app.use(express.static(path.join(__dirname, 'public')));


// ═══════════════════════════════════════════════════════════════
//  MULTER CONFIGURATION — file upload settings
// ═══════════════════════════════════════════════════════════════

// Only allow image files
function imageFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG and WEBP images are allowed'), false);
  }
}

// Avatar uploader — saves as PHT-001.jpg (overwrites old one cleanly)
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATARS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, req.params.id + ext); // e.g. PHT-001.jpg
    }
  }),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB max
});

// Portfolio uploader — saves into uploads/portfolio/PHT-001/
const portfolioUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(PORTFOLIO_DIR, req.params.id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // Unique timestamp filename so multiple uploads don't overwrite
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, Date.now() + ext); // e.g. 1720000000000.jpg
    }
  }),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max per portfolio image
});


// ═══════════════════════════════════════════════════════════════
//  EXCEL HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function readWorkbook() {
  if (!fs.existsSync(FILE_PATH)) return createBlankWorkbook();
  const wb = XLSX.readFile(FILE_PATH);
  const result = {};
  wb.SheetNames.forEach(name => {
    result[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
  });
  return result;
}

function writeWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, FILE_PATH);
}

function readSheet(sheetName) {
  return readWorkbook()[sheetName] || [];
}

function writeSheet(sheetName, rows) {
  const wb = readWorkbook();
  wb[sheetName] = rows;
  writeWorkbook(wb);
}

function newId(prefix = 'ID') {
  return prefix + '-' + Date.now().toString(36).toUpperCase();
}

function now() { return new Date().toISOString(); }

// Convert comma-separated portfolio paths to array
function parsePaths(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

// Convert array of paths back to comma-separated string for Excel
function joinPaths(arr) {
  return arr.join(',');
}


// ═══════════════════════════════════════════════════════════════
//  SEED DATA — first run only
// ═══════════════════════════════════════════════════════════════

function createBlankWorkbook() {
  const sheets = {
    Photographers: [
      {
        id: 'PHT-001', name: 'Sofia Reyes',
        specialty: 'Portrait, Editorial, Wedding',
        service_type: 'Photographer',
        city: 'Mumbai', state: 'Maharashtra',
        phone: '+91 98000 00001', email: 'sofia@example.com',
        half_day_rate: 17280, full_day_rate: 34560, ot_rate_per_hr: 2880,
        experience_yrs: 6, rating: 4.9, total_reviews: 128, total_shoots: 340,
        status: 'Active', outstation: 'Yes',
        avatar_path: '',        // filled when photo is uploaded
        portfolio_paths: '',    // comma-separated paths, filled on upload
        joined_on: '2024-01-15', notes: ''
      },
      {
        id: 'PHT-002', name: 'Marcus Lin',
        specialty: 'Events, Documentary',
        service_type: 'Cinematographer',
        city: 'Mumbai', state: 'Maharashtra',
        phone: '+91 98000 00002', email: 'marcus@example.com',
        half_day_rate: 7200, full_day_rate: 14400, ot_rate_per_hr: 1200,
        experience_yrs: 4, rating: 4.7, total_reviews: 94, total_shoots: 210,
        status: 'Active', outstation: 'No',
        avatar_path: '', portfolio_paths: '',
        joined_on: '2024-03-10', notes: ''
      },
      {
        id: 'PHT-003', name: 'Priya Nair',
        specialty: 'Newborn, Family, Lifestyle',
        service_type: 'Candid Photographer',
        city: 'Pune', state: 'Maharashtra',
        phone: '+91 98000 00003', email: 'priya@example.com',
        half_day_rate: 10560, full_day_rate: 21120, ot_rate_per_hr: 1760,
        experience_yrs: 5, rating: 5.0, total_reviews: 61, total_shoots: 145,
        status: 'Active', outstation: 'Yes',
        avatar_path: '', portfolio_paths: '',
        joined_on: '2024-02-20', notes: ''
      }
    ],
    BookingRequests: [
      {
        id: 'BKG-001', booking_ref: 'LNS-88201',
        client_name: 'Ananya Sharma', client_phone: '+91 99000 00001',
        photographer_id: 'PHT-001', photographer: 'Sofia Reyes',
        service_type: 'Photographer', package: 'Full Day',
        shoot_date: '2026-07-12', start_time: '09:00',
        location: 'Taj Lands End, Mumbai', city: 'Mumbai', state: 'Maharashtra',
        work_type: 'Local', purpose: 'Wedding',
        amount: 34560, gst: 6221, total: 40781,
        status: 'Pending',
        requested_on: '2026-07-02T09:30:00.000Z', responded_on: '',
        notes: 'Drone shots needed for entry'
      },
      {
        id: 'BKG-002', booking_ref: 'LNS-88202',
        client_name: 'Rohan Mehta', client_phone: '+91 99000 00002',
        photographer_id: 'PHT-001', photographer: 'Sofia Reyes',
        service_type: 'Photographer', package: 'Half Day',
        shoot_date: '2026-07-13', start_time: '16:00',
        location: 'Bandra, Mumbai', city: 'Mumbai', state: 'Maharashtra',
        work_type: 'Local', purpose: 'Birthday',
        amount: 17280, gst: 3110, total: 20390,
        status: 'Pending',
        requested_on: '2026-07-02T08:15:00.000Z', responded_on: '', notes: ''
      }
    ]
  };
  writeWorkbook(sheets);
  console.log('📊 Created fresh lensly.xlsx with seed data');
  return sheets;
}


// ═══════════════════════════════════════════════════════════════
//  IMAGE ROUTES
// ═══════════════════════════════════════════════════════════════

// ── POST /api/photographers/:id/avatar ──────────────────────────
// Upload or replace the profile photo for a photographer
// Field name: "avatar"
app.post('/api/photographers/:id/avatar',
  avatarUpload.single('avatar'),
  (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ success: false, error: 'No image file received' });

      const rows = readSheet('Photographers');
      const idx  = rows.findIndex(r => r.id === req.params.id);
      if (idx === -1)
        return res.status(404).json({ success: false, error: 'Photographer not found' });

      // Store relative URL path (served as static)
      const relativePath = `uploads/avatars/${req.file.filename}`;
      rows[idx].avatar_path = relativePath;
      writeSheet('Photographers', rows);

      res.json({
        success: true,
        message: 'Avatar uploaded and saved to Excel',
        avatar_path: relativePath,
        url: `http://localhost:${PORT}/${relativePath}`
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── GET /api/photographers/:id/avatar ───────────────────────────
// Get the current avatar info for a photographer
app.get('/api/photographers/:id/avatar', (req, res) => {
  try {
    const rows = readSheet('Photographers');
    const phot = rows.find(r => r.id === req.params.id);
    if (!phot)
      return res.status(404).json({ success: false, error: 'Photographer not found' });

    const p = phot.avatar_path;
    res.json({
      success: true,
      has_avatar: !!p,
      avatar_path: p || null,
      url: p ? `http://localhost:${PORT}/${p}` : null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/photographers/:id/avatar ────────────────────────
// Remove the profile photo
app.delete('/api/photographers/:id/avatar', (req, res) => {
  try {
    const rows = readSheet('Photographers');
    const idx  = rows.findIndex(r => r.id === req.params.id);
    if (idx === -1)
      return res.status(404).json({ success: false, error: 'Not found' });

    const filePath = path.join(__dirname, rows[idx].avatar_path || '');
    if (rows[idx].avatar_path && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    rows[idx].avatar_path = '';
    writeSheet('Photographers', rows);
    res.json({ success: true, message: 'Avatar removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/photographers/:id/portfolio ───────────────────────
// Upload one or more portfolio images (up to 10 at a time)
// Field name: "images" (multiple)
app.post('/api/photographers/:id/portfolio',
  portfolioUpload.array('images', 10),
  (req, res) => {
    try {
      if (!req.files || req.files.length === 0)
        return res.status(400).json({ success: false, error: 'No images received' });

      const rows = readSheet('Photographers');
      const idx  = rows.findIndex(r => r.id === req.params.id);
      if (idx === -1)
        return res.status(404).json({ success: false, error: 'Photographer not found' });

      // Build relative paths for each uploaded file
      const newPaths = req.files.map(f =>
        `uploads/portfolio/${req.params.id}/${f.filename}`
      );

      // Append to existing portfolio paths in Excel
      const existing = parsePaths(rows[idx].portfolio_paths);
      const combined = [...existing, ...newPaths];

      rows[idx].portfolio_paths = joinPaths(combined);
      writeSheet('Photographers', rows);

      res.json({
        success: true,
        message: `${req.files.length} image(s) uploaded`,
        uploaded: newPaths.map(p => ({
          path: p,
          url: `http://localhost:${PORT}/${p}`
        })),
        total_portfolio: combined.length
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── GET /api/photographers/:id/portfolio ────────────────────────
// List all portfolio images for a photographer
app.get('/api/photographers/:id/portfolio', (req, res) => {
  try {
    const rows = readSheet('Photographers');
    const phot = rows.find(r => r.id === req.params.id);
    if (!phot)
      return res.status(404).json({ success: false, error: 'Not found' });

    const paths  = parsePaths(phot.portfolio_paths);
    const images = paths.map(p => ({
      path: p,
      filename: path.basename(p),
      url: `http://localhost:${PORT}/${p}`,
      exists: fs.existsSync(path.join(__dirname, p))
    }));

    res.json({
      success: true,
      count: images.length,
      images
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/photographers/:id/portfolio/:filename ────────────
// Remove one image from the portfolio
app.delete('/api/photographers/:id/portfolio/:filename', (req, res) => {
  try {
    const rows = readSheet('Photographers');
    const idx  = rows.findIndex(r => r.id === req.params.id);
    if (idx === -1)
      return res.status(404).json({ success: false, error: 'Not found' });

    const target   = `uploads/portfolio/${req.params.id}/${req.params.filename}`;
    const filePath = path.join(__dirname, target);

    // Delete the actual file from disk
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Remove from Excel paths list
    const paths   = parsePaths(rows[idx].portfolio_paths).filter(p => p !== target);
    rows[idx].portfolio_paths = joinPaths(paths);
    writeSheet('Photographers', rows);

    res.json({
      success: true,
      message: 'Image deleted',
      remaining: paths.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/photographers/:id/portfolio (clear all) ──────────
app.delete('/api/photographers/:id/portfolio', (req, res) => {
  try {
    const rows = readSheet('Photographers');
    const idx  = rows.findIndex(r => r.id === req.params.id);
    if (idx === -1)
      return res.status(404).json({ success: false, error: 'Not found' });

    // Delete all files in the portfolio folder
    const dir = path.join(PORTFOLIO_DIR, req.params.id);
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
    }

    rows[idx].portfolio_paths = '';
    writeSheet('Photographers', rows);
    res.json({ success: true, message: 'All portfolio images cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/images/summary ──────────────────────────────────────
// Quick overview of all images on disk
app.get('/api/images/summary', (req, res) => {
  try {
    const avatarFiles    = fs.readdirSync(AVATARS_DIR).filter(f => f !== '.gitkeep');
    const portfolioDirs  = fs.existsSync(PORTFOLIO_DIR)
      ? fs.readdirSync(PORTFOLIO_DIR)
      : [];

    let totalPortfolio = 0;
    portfolioDirs.forEach(dir => {
      const sub = path.join(PORTFOLIO_DIR, dir);
      if (fs.statSync(sub).isDirectory()) {
        totalPortfolio += fs.readdirSync(sub).length;
      }
    });

    res.json({
      success: true,
      avatars: avatarFiles.length,
      portfolio_images: totalPortfolio,
      upload_path: UPLOADS_DIR
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
//  PHOTOGRAPHER ROUTES (unchanged from before)
// ═══════════════════════════════════════════════════════════════

app.get('/api/photographers', (req, res) => {
  try {
    let rows = readSheet('Photographers');
    if (req.query.status)       rows = rows.filter(r => r.status === req.query.status);
    if (req.query.service_type) rows = rows.filter(r => r.service_type === req.query.service_type);
    if (req.query.city)         rows = rows.filter(r => r.city === req.query.city);

    // Add full avatar URL to each row for convenience
    rows = rows.map(r => ({
      ...r,
      avatar_url: r.avatar_path ? `http://localhost:${PORT}/${r.avatar_path}` : null,
      portfolio_urls: parsePaths(r.portfolio_paths)
        .map(p => `http://localhost:${PORT}/${p}`)
    }));

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/photographers/:id', (req, res) => {
  try {
    const rows = readSheet('Photographers');
    const phot = rows.find(r => r.id === req.params.id);
    if (!phot) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({
      success: true,
      data: {
        ...phot,
        avatar_url: phot.avatar_path ? `http://localhost:${PORT}/${phot.avatar_path}` : null,
        portfolio_urls: parsePaths(phot.portfolio_paths).map(p => `http://localhost:${PORT}/${p}`)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/photographers', (req, res) => {
  try {
    const rows = readSheet('Photographers');
    const b = req.body;
    const newPhot = {
      id:             newId('PHT'),
      name:           b.name           || '',
      specialty:      b.specialty       || '',
      service_type:   b.service_type    || 'Photographer',
      city:           b.city            || '',
      state:          b.state           || '',
      phone:          b.phone           || '',
      email:          b.email           || '',
      half_day_rate:  Number(b.half_day_rate)  || 0,
      full_day_rate:  Number(b.full_day_rate)  || 0,
      ot_rate_per_hr: Number(b.ot_rate_per_hr) || 0,
      experience_yrs: Number(b.experience_yrs) || 0,
      rating: 0, total_reviews: 0, total_shoots: 0,
      status:         'Active',
      outstation:     b.outstation || 'No',
      avatar_path:    '',
      portfolio_paths:'',
      joined_on:      new Date().toISOString().split('T')[0],
      notes:          b.notes || ''
    };
    rows.push(newPhot);
    writeSheet('Photographers', rows);
    res.status(201).json({ success: true, data: newPhot });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/photographers/:id', (req, res) => {
  try {
    const rows = readSheet('Photographers');
    const idx  = rows.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    rows[idx] = { ...rows[idx], ...req.body };
    writeSheet('Photographers', rows);
    res.json({ success: true, data: rows[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/photographers/:id', (req, res) => {
  try {
    let rows = readSheet('Photographers');
    const before = rows.length;
    rows = rows.filter(r => r.id !== req.params.id);
    if (rows.length === before)
      return res.status(404).json({ success: false, error: 'Not found' });
    writeSheet('Photographers', rows);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
//  BOOKING ROUTES (unchanged)
// ═══════════════════════════════════════════════════════════════

app.get('/api/bookings', (req, res) => {
  try {
    let rows = readSheet('BookingRequests');
    if (req.query.photographer_id) rows = rows.filter(r => r.photographer_id === req.query.photographer_id);
    if (req.query.status)          rows = rows.filter(r => r.status === req.query.status);
    rows.sort((a, b) => new Date(b.requested_on) - new Date(a.requested_on));
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/bookings/:id', (req, res) => {
  try {
    const rows = readSheet('BookingRequests');
    const bkg  = rows.find(r => r.id === req.params.id);
    if (!bkg) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: bkg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/bookings', (req, res) => {
  try {
    const rows = readSheet('BookingRequests');
    const b    = req.body;
    const amount = Number(b.amount) || 0;
    const gst    = Math.round(amount * 0.18);
    const newBkg = {
      id: newId('BKG'), booking_ref: 'LNS-' + Math.floor(10000 + Math.random() * 89999),
      client_name: b.client_name || '', client_phone: b.client_phone || '',
      photographer_id: b.photographer_id || '', photographer: b.photographer || '',
      service_type: b.service_type || '', package: b.package || '',
      shoot_date: b.shoot_date || '', start_time: b.start_time || '',
      location: b.location || '', city: b.city || '', state: b.state || '',
      work_type: b.work_type || 'Local', purpose: b.purpose || '',
      amount, gst, total: amount + gst,
      status: 'Pending',
      requested_on: now(), responded_on: '', notes: b.notes || ''
    };
    rows.push(newBkg);
    writeSheet('BookingRequests', rows);
    res.status(201).json({ success: true, data: newBkg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/bookings/:id/accept', (req, res) => {
  try {
    const rows = readSheet('BookingRequests');
    const idx  = rows.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    if (rows[idx].status !== 'Pending')
      return res.status(400).json({ success: false, error: `Already ${rows[idx].status}` });
    rows[idx].status = 'Accepted'; rows[idx].responded_on = now();
    writeSheet('BookingRequests', rows);
    res.json({ success: true, message: 'Booking accepted', data: rows[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/bookings/:id/reject', (req, res) => {
  try {
    const rows = readSheet('BookingRequests');
    const idx  = rows.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    if (rows[idx].status !== 'Pending')
      return res.status(400).json({ success: false, error: `Already ${rows[idx].status}` });
    rows[idx].status = 'Rejected'; rows[idx].responded_on = now();
    if (req.body.reason) rows[idx].notes = req.body.reason;
    writeSheet('BookingRequests', rows);
    res.json({ success: true, message: 'Booking rejected', data: rows[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/bookings/:id/complete', (req, res) => {
  try {
    const rows = readSheet('BookingRequests');
    const idx  = rows.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    rows[idx].status = 'Completed';
    writeSheet('BookingRequests', rows);
    res.json({ success: true, data: rows[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/summary', (req, res) => {
  try {
    const photographers = readSheet('Photographers');
    const bookings      = readSheet('BookingRequests');
    const pending   = bookings.filter(b => b.status === 'Pending').length;
    const accepted  = bookings.filter(b => b.status === 'Accepted').length;
    const completed = bookings.filter(b => b.status === 'Completed').length;
    const rejected  = bookings.filter(b => b.status === 'Rejected').length;
    const revenue   = bookings.filter(b => b.status !== 'Rejected' && b.status !== 'Pending')
                              .reduce((s, b) => s + (Number(b.amount)||0), 0);
    res.json({
      success: true,
      data: {
        photographers: {
          total: photographers.length,
          active: photographers.filter(p => p.status === 'Active').length
        },
        bookings: { pending, accepted, completed, rejected, total: bookings.length },
        revenue: { total: revenue, formatted: '₹' + revenue.toLocaleString('en-IN') }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
//  ERROR HANDLER (catches multer errors too)
// ═══════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ success: false, error: 'File too large. Max 5 MB for avatar, 10 MB for portfolio.' });
  res.status(400).json({ success: false, error: err.message });
});


// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔════════════════════════════════════════════╗');
  console.log('  ║       Lensly Backend — Running             ║');
  console.log(`  ║   http://localhost:${PORT}                  ║`);
  console.log('  ║   Data   → ./data/lensly.xlsx              ║');
  console.log('  ║   Images → ./uploads/                      ║');
  console.log('  ╚════════════════════════════════════════════╝');
  console.log('');
  console.log('  Image endpoints:');
  console.log('  POST   /api/photographers/:id/avatar        ← upload profile photo');
  console.log('  GET    /api/photographers/:id/avatar        ← get avatar info');
  console.log('  DELETE /api/photographers/:id/avatar        ← remove avatar');
  console.log('  POST   /api/photographers/:id/portfolio     ← upload portfolio images');
  console.log('  GET    /api/photographers/:id/portfolio     ← list portfolio');
  console.log('  DELETE /api/photographers/:id/portfolio/:f  ← delete one image');
  console.log('  GET    /api/images/summary                  ← count all images on disk');
  console.log('');
  readWorkbook(); // ensure Excel exists
});
