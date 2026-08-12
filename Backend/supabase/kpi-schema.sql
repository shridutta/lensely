-- ═══════════════════════════════════════════════════════════════
--  kpis — admin overrides for the dashboard KPI strip (Take Booking
--  page: "Booked This Month", "Received This Month", "To Collect").
--  Run once in the Supabase SQL editor, alongside the other schema
--  files.
--
--  These three KPIs are computed LIVE from booking_requests by
--  default (see GET /api/kpis in Backend/server.js) — this table
--  only holds an ADMIN OVERRIDE when someone wants to correct a
--  number or show a custom figure instead of the live computation.
--  No rows here = every KPI just shows its live-computed value.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.kpis (
  key        text primary key,      -- e.g. 'booked_this_month'
  label      text not null,         -- e.g. 'Booked This Month'
  value      numeric not null default 0,
  unit       text not null default '',   -- '₹', '', etc. — prefix shown before the value
  updated_at timestamptz not null default now()
);

alter table public.kpis enable row level security;
