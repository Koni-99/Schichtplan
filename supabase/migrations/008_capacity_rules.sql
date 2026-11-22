-- =====================================================================
-- Pausen nur zur vollen/halben Stunde, max. 3 gleichzeitig, ab 14:30 max. 2
-- =====================================================================
alter table public.settings
  add column if not exists capacity_rules jsonb not null default '[{"from": 870, "max": 2}]',  -- ab 14:30 max. 2
  add column if not exists pause_grid_min smallint not null default 30;                      -- :00 / :30

alter table public.settings alter column max_concurrent_pauses set default 3;
update public.settings set max_concurrent_pauses = 3 where id = 1 and max_concurrent_pauses = 4;
