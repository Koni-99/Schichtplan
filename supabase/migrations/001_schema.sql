-- =====================================================================
-- Pausenplaner Bäckerei-Filiale – Supabase-Schema
-- Zeiten innerhalb eines Tages werden als "Minuten seit Mitternacht"
-- (smallint, 0–1439) gespeichert, z. B. 08:30 = 510. Das macht Planung,
-- Vergleich und Sortierung trivial und vermeidet Zeitzonenprobleme.
-- Echte Zeitpunkte (Pausenstart/-ende per Live-Timer) sind timestamptz.
-- Löschungen erfolgen ausschließlich als Soft-Delete (deleted_at), damit
-- die Offline-Synchronisation (Last-Write-Wins über updated_at) konsistent bleibt.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Typen
-- ---------------------------------------------------------------------
do $$ begin
  create type app_role as enum ('filiale', 'filialleitung', 'personalleitung');
exception when duplicate_object then null; end $$;

do $$ begin
  -- standard        = 2 × 30 Min. flexibel (bzw. Werte aus den Einstellungen)
  -- flexible_custom = Sondermodell flexibel (z. B. 2 × 15 oder 1 × 30)
  -- fixed           = feste Pausen-Uhrzeiten
  -- none            = keine Pause
  create type pause_model as enum ('standard', 'flexible_custom', 'fixed', 'none');
exception when duplicate_object then null; end $$;

do $$ begin
  create type shift_status as enum ('present', 'sick', 'left_early', 'came_late', 'absent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pause_status as enum ('open', 'running', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type plan_status as enum ('open', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type closed_type as enum ('manual', 'auto');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Benutzerprofile / Rollen
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role         app_role not null default 'filiale',
  created_at   timestamptz not null default now()
);

-- Rolle des aktuell angemeldeten Benutzers (security definer => keine RLS-Rekursion)
create or replace function public.auth_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Neues Auth-Konto => Profil mit Rolle aus raw_user_meta_data.role (Standard: filiale)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'filiale')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Einstellungen (genau eine Zeile, id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                         smallint primary key default 1 check (id = 1),
  max_concurrent_pauses      smallint not null default 4,
  auto_close_time            smallint not null default 1170,  -- 19:30
  auto_close_enabled         boolean  not null default true,
  min_after_start_min        smallint not null default 90,    -- Block 1 frühestens 1,5 h nach Beginn
  min_between_blocks_min     smallint not null default 90,    -- mind. 1,5 h zwischen den Blöcken
  min_before_end_min         smallint not null default 60,    -- letzter Block spätestens 1 h vor Ende
  default_block_count        smallint not null default 2,
  default_block_minutes      smallint not null default 30,
  short_shift_threshold_min  smallint not null default 360,   -- < 6 h = Kurzschicht
  short_shift_block_count    smallint not null default 0,
  short_shift_block_minutes  smallint not null default 15,
  count_unstarted_as_taken   boolean  not null default false, -- nicht gestartete Pausen beim Abschluss als genommen werten
  timezone                   text     not null default 'Europe/Berlin',
  updated_at                 timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Mitarbeiter-Stammdaten inkl. Pausenprofil
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  name_key          text not null,                 -- normalisiert (lower, ohne Leerzeichen-Varianz) für den PDF-Abgleich
  pause_model       pause_model not null default 'standard',
  custom_block_count   smallint not null default 2,  -- nur flexible_custom
  custom_block_minutes smallint not null default 15, -- nur flexible_custom
  fixed_starts      smallint[] not null default '{}', -- nur fixed: Startzeiten in Minuten, z. B. {600, 810}
  fixed_block_minutes smallint not null default 30,   -- nur fixed
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create unique index if not exists employees_name_key_uidx on public.employees (name_key) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Tagespläne
-- ---------------------------------------------------------------------
create table if not exists public.daily_plans (
  id               uuid primary key default gen_random_uuid(),
  plan_date        date not null,
  status           plan_status not null default 'open',
  closed_at        timestamptz,
  closed_type      closed_type,                    -- manual | auto
  closed_by        uuid references auth.users(id),
  closed_label     text,                           -- z. B. "Automatisch abgeschlossen um 19:30 Uhr"
  is_read_by_hr    boolean not null default false, -- Ungelesen-Status für die Personalleitung
  hr_read_at       timestamptz,
  hr_processed     boolean not null default false, -- "Als bearbeitet markieren" (in PEPZeit übertragen)
  hr_processed_at  timestamptz,
  has_deviations   boolean not null default false,
  source_filename  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create unique index if not exists daily_plans_date_uidx on public.daily_plans (plan_date) where deleted_at is null;
create index if not exists daily_plans_unread_idx on public.daily_plans (is_read_by_hr) where status = 'closed';

-- ---------------------------------------------------------------------
-- Schichteinträge (Soll aus PEPZeit, Ist aus dem Filialbetrieb)
-- ---------------------------------------------------------------------
create table if not exists public.shift_entries (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references public.daily_plans(id) on delete cascade,
  employee_id        uuid references public.employees(id),
  employee_name      text not null,
  planned_start_min  smallint,                      -- Soll (PEPZeit), null bei Springern
  planned_end_min    smallint,
  actual_start_min   smallint,                      -- Ist (null = wie Soll)
  actual_end_min     smallint,
  planned_pause_min  smallint not null default 0,   -- Soll-Gesamtpause (beim Planen eingefroren)
  actual_pause_min   smallint,                      -- Ist-Gesamtpause (beim Tagesabschluss berechnet)
  status             shift_status not null default 'present',
  is_manual          boolean not null default false, -- "Manuell ergänzt" (Springer/Aushilfe)
  note               text not null default '',
  sort_order         smallint not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists shift_entries_plan_idx on public.shift_entries (plan_id);

-- ---------------------------------------------------------------------
-- Pausenblöcke (Block 1, Block 2, …)
-- ---------------------------------------------------------------------
create table if not exists public.pause_blocks (
  id                   uuid primary key default gen_random_uuid(),
  plan_id              uuid not null references public.daily_plans(id) on delete cascade,
  shift_entry_id       uuid not null references public.shift_entries(id) on delete cascade,
  block_no             smallint not null,
  start_min            smallint not null,            -- aktuell geplante Startzeit (verschiebbar)
  planned_duration_min smallint not null,            -- Soll-Dauer
  is_fixed             boolean not null default false, -- aus festem Pausenprofil
  status               pause_status not null default 'open',
  actual_start_at      timestamptz,
  actual_end_at        timestamptz,
  actual_duration_min  smallint,                     -- Ist-Dauer
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create index if not exists pause_blocks_plan_idx on public.pause_blocks (plan_id);
create index if not exists pause_blocks_shift_idx on public.pause_blocks (shift_entry_id);

-- Inkrementeller Sync: Abfragen nach updated_at
create index if not exists employees_updated_idx     on public.employees (updated_at);
create index if not exists daily_plans_updated_idx   on public.daily_plans (updated_at);
create index if not exists shift_entries_updated_idx on public.shift_entries (updated_at);
create index if not exists pause_blocks_updated_idx  on public.pause_blocks (updated_at);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.settings      enable row level security;
alter table public.employees     enable row level security;
alter table public.daily_plans   enable row level security;
alter table public.shift_entries enable row level security;
alter table public.pause_blocks  enable row level security;

-- Profile: jeder sieht das eigene Profil
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (id = auth.uid());

-- Einstellungen: alle angemeldeten lesen, Filialleitung schreibt
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (auth.uid() is not null);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for update
  using (public.auth_role() = 'filialleitung') with check (public.auth_role() = 'filialleitung');
drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings for insert with check (public.auth_role() = 'filialleitung');

-- Mitarbeiter: alle lesen, Filialleitung pflegt Stammdaten
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select using (auth.uid() is not null);
drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert with check (public.auth_role() = 'filialleitung');
drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update
  using (public.auth_role() = 'filialleitung') with check (public.auth_role() = 'filialleitung');

-- Tagespläne
drop policy if exists plans_read on public.daily_plans;
create policy plans_read on public.daily_plans for select using (auth.uid() is not null);
drop policy if exists plans_insert on public.daily_plans;
create policy plans_insert on public.daily_plans for insert
  with check (public.auth_role() = 'filialleitung');
-- Filiale/Filialleitung: nur offene Pläne bearbeiten (inkl. Abschließen)
drop policy if exists plans_update_store on public.daily_plans;
create policy plans_update_store on public.daily_plans for update
  using (public.auth_role() in ('filiale', 'filialleitung') and status = 'open')
  with check (public.auth_role() in ('filiale', 'filialleitung'));
-- Personalleitung: nur abgeschlossene Pläne (Lese-/Bearbeitet-Status, s. Trigger)
drop policy if exists plans_update_hr on public.daily_plans;
create policy plans_update_hr on public.daily_plans for update
  using (public.auth_role() = 'personalleitung' and status = 'closed')
  with check (public.auth_role() = 'personalleitung');

-- Personalleitung darf ausschließlich die HR-Felder ändern
create or replace function public.guard_hr_plan_update() returns trigger
language plpgsql as $$
begin
  if public.auth_role() = 'personalleitung' then
    if (new.plan_date, new.status, new.closed_at, new.closed_type, new.closed_label,
        new.has_deviations, new.deleted_at)
       is distinct from
       (old.plan_date, old.status, old.closed_at, old.closed_type, old.closed_label,
        old.has_deviations, old.deleted_at) then
      raise exception 'Personalleitung darf nur den Lese-/Bearbeitungsstatus ändern';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_hr_plan_update on public.daily_plans;
create trigger guard_hr_plan_update before update on public.daily_plans
  for each row execute function public.guard_hr_plan_update();

-- Hilfsfunktion: gehört der Datensatz zu einem offenen Plan?
create or replace function public.plan_is_open(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.daily_plans where id = p_plan and status = 'open')
$$;

-- Schichten & Pausen: alle lesen, Filiale/Filialleitung schreiben solange der Plan offen ist
drop policy if exists shifts_read on public.shift_entries;
create policy shifts_read on public.shift_entries for select using (auth.uid() is not null);
drop policy if exists shifts_write on public.shift_entries;
create policy shifts_write on public.shift_entries for insert
  with check (public.auth_role() in ('filiale', 'filialleitung') and public.plan_is_open(plan_id));
drop policy if exists shifts_update on public.shift_entries;
create policy shifts_update on public.shift_entries for update
  using (public.auth_role() in ('filiale', 'filialleitung') and public.plan_is_open(plan_id))
  with check (public.auth_role() in ('filiale', 'filialleitung'));

drop policy if exists pauses_read on public.pause_blocks;
create policy pauses_read on public.pause_blocks for select using (auth.uid() is not null);
drop policy if exists pauses_write on public.pause_blocks;
create policy pauses_write on public.pause_blocks for insert
  with check (public.auth_role() in ('filiale', 'filialleitung') and public.plan_is_open(plan_id));
drop policy if exists pauses_update on public.pause_blocks;
create policy pauses_update on public.pause_blocks for update
  using (public.auth_role() in ('filiale', 'filialleitung') and public.plan_is_open(plan_id))
  with check (public.auth_role() in ('filiale', 'filialleitung'));

-- =====================================================================
-- Realtime
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['settings', 'employees', 'daily_plans', 'shift_entries', 'pause_blocks'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
