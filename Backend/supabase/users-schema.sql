-- ═══════════════════════════════════════════════════════════════
--  users — general account table; `is_admin = true` grants access to
--  the global "Take Booking" tool's PIN gate. Run once in the
--  Supabase SQL editor, alongside the other schema files.
--
--  This is deliberately generic (not "admins") so it can grow to
--  hold other account types later — for now the only rows in it are
--  admin operators, gated purely by the is_admin flag.
--
--  The PIN is stored bcrypt-hashed via Postgres's pgcrypto extension
--  so it never sits in plaintext, even in the seed script — and it's
--  verified the same way (bcrypt) on the Node side in db.js/auth-api.js.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create table if not exists public.users (
  id         bigint generated always as identity primary key,
  name       text not null default 'Admin',
  email      text,
  pin_hash   text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

-- Seed exactly one default admin user, only if the table is currently
-- empty (safe to re-run). Default PIN: 482917 — CHANGE THIS after first
-- login, either via POST /api/auth/admin/pin/change or by re-running:
--   update public.users set pin_hash = crypt('<new 6-digit pin>', gen_salt('bf')) where id = 1;
insert into public.users (name, pin_hash, is_admin)
select 'Default Admin', crypt('482917', gen_salt('bf')), true
where not exists (select 1 from public.users where is_admin = true);
