-- ═══════════════════════════════════════════════════════════════
--  otp_codes — real OTP delivery (email + WhatsApp)
--  Run once in the Supabase SQL editor, in addition to schema.sql.
--  Stores a bcrypt HASH of each code (never the plaintext), with a
--  short expiry, an attempt counter, and a consumed marker so a
--  code can only be used once.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.otp_codes (
  id          bigint generated always as identity primary key,
  channel     text not null,              -- 'email' | 'mobile' (delivered via WhatsApp)
  target      text not null,              -- normalised email (lowercase) or +91XXXXXXXXXX
  purpose     text not null,              -- 'guest' | 'customer' | 'photographer' | 'photographer_signup'
  code_hash   text not null,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_otp_lookup on public.otp_codes (channel, target, purpose, created_at desc);

-- Server-only access via the service_role key, same pattern as the other tables.
alter table public.otp_codes enable row level security;
