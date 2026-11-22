-- =====================================================================
-- Pausenlänge nach Schichtlänge, feste erste Pause je Schichtbeginn,
-- Pausengruppen (Mitarbeiter, die gemeinsam in Pause gehen)
-- =====================================================================
alter table public.settings
  add column if not exists length_rules jsonb default
    '[{"from": 0, "count": 0, "minutes": 30}, {"from": 360, "count": 1, "minutes": 30}, {"from": 540, "count": 2, "minutes": 30}]',
  add column if not exists start_rules jsonb default
    '[{"start": 570, "first": 690}, {"start": 600, "first": 720}]';   -- 09:30 → 11:30, 10:00 → 12:00

alter table public.employees
  add column if not exists pause_group text;                         -- z. B. 'Öffner'
