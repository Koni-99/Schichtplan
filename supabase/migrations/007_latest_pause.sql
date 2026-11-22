-- =====================================================================
-- Betriebsregel: letzte Pause startet spätestens um … (Standard 15:30)
-- =====================================================================
alter table public.settings
  add column if not exists latest_pause_start smallint default 930;  -- 15:30, null = keine Grenze
