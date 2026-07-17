-- ═══════════════════════════════════════════════════════════════
--  Sample portfolio images — REMOTE URLs only (no storage upload).
--  Run once in the Supabase SQL editor. Photographers manage their
--  own links later via the Lensly X portal (paste any image URL:
--  their site, Instagram CDN, Google-hosted folio, etc.).
--  path = '' marks a remote link (uploads keep their storage path).
-- ═══════════════════════════════════════════════════════════════

insert into public.portfolio_images (photographer_id, path, url) values
  -- Sofia Reyes — portrait / editorial / wedding
  ('PHT-001', '', 'https://picsum.photos/id/1027/800/1000'),
  ('PHT-001', '', 'https://picsum.photos/id/1011/800/600'),
  ('PHT-001', '', 'https://picsum.photos/id/883/800/600'),
  ('PHT-001', '', 'https://picsum.photos/id/452/800/600'),
  ('PHT-001', '', 'https://picsum.photos/id/331/800/600'),

  -- Marcus Lin — events / documentary
  ('PHT-002', '', 'https://picsum.photos/id/122/800/600'),
  ('PHT-002', '', 'https://picsum.photos/id/250/800/1000'),
  ('PHT-002', '', 'https://picsum.photos/id/306/800/600'),
  ('PHT-002', '', 'https://picsum.photos/id/431/800/600'),

  -- Priya Nair — newborn / family / lifestyle
  ('PHT-003', '', 'https://picsum.photos/id/177/800/1000'),
  ('PHT-003', '', 'https://picsum.photos/id/342/800/600'),
  ('PHT-003', '', 'https://picsum.photos/id/553/800/600'),
  ('PHT-003', '', 'https://picsum.photos/id/646/800/600');
