// ═══════════════════════════════════════════════════════════════
//  db.js — Supabase data + storage layer for Lensly
//  Replaces the old Excel (xlsx) "database" and local multer disk
//  uploads. Everything now lives in Supabase:
//    • Postgres tables  → photographers, booking_requests, portfolio_images
//    • Storage buckets  → avatars (public), portfolio (public)
//
//  Auth stays custom (JWT + bcrypt) — see auth-api.js — but the
//  photographer rows it reads/writes live here in Postgres.
//
//  Uses the SERVICE ROLE key, so it must ONLY run on the server.
// ═══════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n  ✗ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('    Copy .env.example → .env and fill in your Supabase project values.\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const AVATAR_BUCKET    = 'avatars';
const PORTFOLIO_BUCKET = 'portfolio';

// ── Helpers ────────────────────────────────────────────────────
function newId(prefix = 'ID') {
  return prefix + '-' + Date.now().toString(36).toUpperCase() +
         Math.floor(Math.random() * 1000).toString(36).toUpperCase();
}
function nowIso() { return new Date().toISOString(); }
function unwrap({ data, error }) { if (error) throw new Error(error.message); return data; }

// ═══════════════════════════════════════════════════════════════
//  PHOTOGRAPHERS
// ═══════════════════════════════════════════════════════════════
async function listPhotographers(filters = {}) {
  let q = supabase.from('photographers').select('*');
  if (filters.status)       q = q.eq('status', filters.status);
  if (filters.service_type) q = q.eq('service_type', filters.service_type);
  if (filters.city)         q = q.eq('city', filters.city);
  const rows = unwrap(await q);

  // Attach portfolio urls in one grouped query
  const ids = rows.map(r => r.id);
  const byPhotog = {};
  if (ids.length) {
    const imgs = unwrap(await supabase.from('portfolio_images').select('photographer_id,url').in('photographer_id', ids));
    imgs.forEach(im => { (byPhotog[im.photographer_id] ||= []).push(im.url); });
  }
  return rows.map(r => ({ ...r, portfolio_urls: byPhotog[r.id] || [] }));
}

async function getPhotographerById(id) {
  const { data, error } = await supabase.from('photographers').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function getPhotographerByEmail(email) {
  const { data, error } = await supabase.from('photographers').select('*')
    .ilike('email', String(email).trim()).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function createPhotographer(b) {
  const row = {
    id: newId('PHT'),
    name: b.name || '', specialty: b.specialty || '', service_type: b.service_type || 'Photographer',
    city: b.city || '', state: b.state || '', phone: b.phone || '', email: b.email || '',
    half_day_rate: Number(b.half_day_rate) || 0, full_day_rate: Number(b.full_day_rate) || 0,
    ot_rate_per_hr: Number(b.ot_rate_per_hr) || 0, experience_yrs: Number(b.experience_yrs) || 0,
    rating: 0, total_reviews: 0, total_shoots: 0,
    status: 'Active', outstation: b.outstation || 'No',
    avatar_url: null, joined_on: new Date().toISOString().slice(0, 10), notes: b.notes || ''
  };
  return unwrap(await supabase.from('photographers').insert(row).select().single());
}

async function updatePhotographer(id, patch) {
  const { data, error } = await supabase.from('photographers').update(patch).eq('id', id).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function deletePhotographer(id) {
  const data = unwrap(await supabase.from('photographers').delete().eq('id', id).select('id'));
  return data.length > 0;
}

// ═══════════════════════════════════════════════════════════════
//  PORTFOLIO IMAGES
// ═══════════════════════════════════════════════════════════════
async function listPortfolio(photographerId) {
  return unwrap(await supabase.from('portfolio_images')
    .select('*').eq('photographer_id', photographerId).order('created_at', { ascending: true }));
}
async function addPortfolioImages(photographerId, images /* [{path,url}] */) {
  const rows = images.map(im => ({ photographer_id: photographerId, path: im.path, url: im.url }));
  return unwrap(await supabase.from('portfolio_images').insert(rows).select());
}
async function deletePortfolioImageByPath(photographerId, path) {
  return unwrap(await supabase.from('portfolio_images')
    .delete().eq('photographer_id', photographerId).eq('path', path).select());
}
async function clearPortfolio(photographerId) {
  return unwrap(await supabase.from('portfolio_images')
    .delete().eq('photographer_id', photographerId).select());
}

// ═══════════════════════════════════════════════════════════════
//  BOOKINGS
// ═══════════════════════════════════════════════════════════════
async function listBookings(filters = {}) {
  let q = supabase.from('booking_requests').select('*');
  if (filters.photographer_id) q = q.eq('photographer_id', filters.photographer_id);
  if (filters.status)          q = q.eq('status', filters.status);
  return unwrap(await q.order('requested_on', { ascending: false }));
}
async function getBookingById(id) {
  const { data, error } = await supabase.from('booking_requests').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}
async function createBooking(b) {
  const amount = Number(b.amount) || 0;
  const gst    = Math.round(amount * 0.18);
  const row = {
    id: newId('BKG'), booking_ref: 'LNS-' + Math.floor(10000 + Math.random() * 89999),
    client_name: b.client_name || '', client_phone: b.client_phone || '',
    photographer_id: b.photographer_id || null, photographer: b.photographer || '',
    service_type: b.service_type || '', package: b.package || '',
    shoot_date: b.shoot_date || null, start_time: b.start_time || '',
    location: b.location || '', city: b.city || '', state: b.state || '',
    work_type: b.work_type || 'Local', purpose: b.purpose || '',
    amount, gst, total: amount + gst, status: 'Pending',
    requested_on: nowIso(), responded_on: null, notes: b.notes || ''
  };
  return unwrap(await supabase.from('booking_requests').insert(row).select().single());
}
async function updateBooking(id, patch) {
  const { data, error } = await supabase.from('booking_requests').update(patch).eq('id', id).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// ═══════════════════════════════════════════════════════════════
//  STORAGE (replaces local /uploads)
// ═══════════════════════════════════════════════════════════════
async function uploadToBucket(bucket, path, buffer, contentType) {
  const { error } = await supabase.storage.from(bucket)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { path, url: data.publicUrl };
}
async function removeFromBucket(bucket, paths) {
  const { error } = await supabase.storage.from(bucket).remove([].concat(paths));
  if (error) throw new Error(error.message);
}

module.exports = {
  supabase, AVATAR_BUCKET, PORTFOLIO_BUCKET, newId, nowIso,
  listPhotographers, getPhotographerById, getPhotographerByEmail,
  createPhotographer, updatePhotographer, deletePhotographer,
  listPortfolio, addPortfolioImages, deletePortfolioImageByPath, clearPortfolio,
  listBookings, getBookingById, createBooking, updateBooking,
  uploadToBucket, removeFromBucket
};
