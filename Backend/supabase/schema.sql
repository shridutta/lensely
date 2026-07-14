-- ═══════════════════════════════════════════════════════════════
--  Lensly — Supabase schema
--  Run in the Supabase SQL editor (Dashboard → SQL → New query).
--  Creates tables, indexes, storage buckets, and seed data that
--  replace the old data/lensly.xlsx workbook.
-- ═══════════════════════════════════════════════════════════════

-- ── Photographers ──────────────────────────────────────────────
create table if not exists public.photographers (
  id             text primary key,
  name           text not null default '',
  specialty      text default '',
  service_type   text default 'Photographer',
  city           text default '',
  state          text default '',
  phone          text default '',
  email          text unique,
  half_day_rate  numeric default 0,
  full_day_rate  numeric default 0,
  ot_rate_per_hr numeric default 0,
  experience_yrs numeric default 0,
  rating         numeric default 0,
  total_reviews  integer default 0,
  total_shoots   integer default 0,
  status         text default 'Active',
  outstation     text default 'No',
  avatar_url     text,
  joined_on      date default now(),
  notes          text default '',
  password_hash  text,                         -- bcrypt hash (custom auth)
  created_at     timestamptz default now()
);
create index if not exists idx_photographers_service on public.photographers (service_type);
create index if not exists idx_photographers_city    on public.photographers (city);
create index if not exists idx_photographers_email   on public.photographers (lower(email));

-- ── Portfolio images (one row per uploaded image) ──────────────
create table if not exists public.portfolio_images (
  id              bigint generated always as identity primary key,
  photographer_id text not null references public.photographers(id) on delete cascade,
  path            text not null,               -- object path inside the "portfolio" bucket
  url             text not null,               -- public URL
  created_at      timestamptz default now()
);
create index if not exists idx_portfolio_photog on public.portfolio_images (photographer_id);

-- ── Booking requests ───────────────────────────────────────────
create table if not exists public.booking_requests (
  id              text primary key,
  booking_ref     text,
  client_name     text default '',
  client_phone    text default '',
  photographer_id text references public.photographers(id) on delete set null,
  photographer    text default '',
  service_type    text default '',
  package         text default '',
  shoot_date      date,
  start_time      text default '',
  location        text default '',
  city            text default '',
  state           text default '',
  work_type       text default 'Local',
  purpose         text default '',
  amount          numeric default 0,
  gst             numeric default 0,
  total           numeric default 0,
  status          text default 'Pending',
  requested_on    timestamptz default now(),
  responded_on    timestamptz,
  notes           text default ''
);
create index if not exists idx_bookings_photog on public.booking_requests (photographer_id);
create index if not exists idx_bookings_status on public.booking_requests (status);

-- ── Row Level Security ─────────────────────────────────────────
-- The API uses the SERVICE ROLE key, which bypasses RLS. We enable
-- RLS with NO public policies so the anon/public keys cannot touch
-- these tables directly — all access must go through the backend.
alter table public.photographers    enable row level security;
alter table public.portfolio_images enable row level security;
alter table public.booking_requests enable row level security;

-- ── Storage buckets (public read) ──────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true), ('portfolio', 'portfolio', true)
on conflict (id) do nothing;

-- ── Seed data (mirrors the old xlsx seed) ──────────────────────
insert into public.photographers
  (id, name, specialty, service_type, city, state, phone, email,
   half_day_rate, full_day_rate, ot_rate_per_hr, experience_yrs,
   rating, total_reviews, total_shoots, status, outstation, joined_on)
values
  ('PHT-001','Sofia Reyes','Portrait, Editorial, Wedding','Photographer','Mumbai','Maharashtra','+91 98000 00001','sofia@example.com',
   17280,34560,2880,6,4.9,128,340,'Active','Yes','2024-01-15'),
  ('PHT-002','Marcus Lin','Events, Documentary','Cinematographer','Mumbai','Maharashtra','+91 98000 00002','marcus@example.com',
   7200,14400,1200,4,4.7,94,210,'Active','No','2024-03-10'),
  ('PHT-003','Priya Nair','Newborn, Family, Lifestyle','Candid Photographer','Pune','Maharashtra','+91 98000 00003','priya@example.com',
   10560,21120,1760,5,5.0,61,145,'Active','Yes','2024-02-20')
on conflict (id) do nothing;
