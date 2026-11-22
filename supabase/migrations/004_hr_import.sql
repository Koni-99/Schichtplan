-- =====================================================================
-- Personalleitung erstellt die Pläne (PEPZeit-Wochen-PDF hochladen)
-- Sie darf neue Tagespläne anlegen und künftige, noch offene Pläne ersetzen.
-- Der heutige Tag und abgeschlossene Tage bleiben für sie gesperrt
-- (Änderungen am heutigen Tag nur durch die Filiale in der App).
-- =====================================================================

-- "Heute" in der Zeitzone der Filiale
create or replace function public.local_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.settings where id = 1), 'Europe/Berlin'))::date
$$;

-- Plan offen und ab heute (für neue Einträge) bzw. in der Zukunft (für Änderungen)
create or replace function public.plan_is_open_from_today(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.daily_plans where id = p_plan and status = 'open' and plan_date >= public.local_today())
$$;
create or replace function public.plan_is_future_open(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.daily_plans where id = p_plan and status = 'open' and plan_date > public.local_today())
$$;

-- Tagespläne
drop policy if exists plans_insert_hr on public.daily_plans;
create policy plans_insert_hr on public.daily_plans for insert
  with check (public.auth_role() = 'personalleitung' and status = 'open' and plan_date >= public.local_today());

drop policy if exists plans_update_hr_future on public.daily_plans;
create policy plans_update_hr_future on public.daily_plans for update
  using (public.auth_role() = 'personalleitung' and status = 'open' and plan_date > public.local_today())
  with check (public.auth_role() = 'personalleitung' and status = 'open');

-- HR-Schutz gilt nur noch für abgeschlossene Pläne (dort nur Lese-/Bearbeitet-Status)
create or replace function public.guard_hr_plan_update() returns trigger
language plpgsql as $$
begin
  if public.auth_role() = 'personalleitung' and old.status = 'closed' then
    if (new.plan_date, new.status, new.closed_at, new.closed_type, new.closed_label,
        new.has_deviations, new.deleted_at)
       is distinct from
       (old.plan_date, old.status, old.closed_at, old.closed_type, old.closed_label,
        old.has_deviations, old.deleted_at) then
      raise exception 'Personalleitung darf bei abgeschlossenen Plänen nur den Lese-/Bearbeitungsstatus ändern';
    end if;
  end if;
  return new;
end $$;

-- Schichten & Pausen
drop policy if exists shifts_insert_hr on public.shift_entries;
create policy shifts_insert_hr on public.shift_entries for insert
  with check (public.auth_role() = 'personalleitung' and public.plan_is_open_from_today(plan_id));
drop policy if exists shifts_update_hr on public.shift_entries;
create policy shifts_update_hr on public.shift_entries for update
  using (public.auth_role() = 'personalleitung' and public.plan_is_future_open(plan_id))
  with check (public.auth_role() = 'personalleitung');

drop policy if exists pauses_insert_hr on public.pause_blocks;
create policy pauses_insert_hr on public.pause_blocks for insert
  with check (public.auth_role() = 'personalleitung' and public.plan_is_open_from_today(plan_id));
drop policy if exists pauses_update_hr on public.pause_blocks;
create policy pauses_update_hr on public.pause_blocks for update
  using (public.auth_role() = 'personalleitung' and public.plan_is_future_open(plan_id))
  with check (public.auth_role() = 'personalleitung');

-- Neue Mitarbeiter werden beim Import automatisch in den Stammdaten angelegt
drop policy if exists employees_insert_hr on public.employees;
create policy employees_insert_hr on public.employees for insert
  with check (public.auth_role() = 'personalleitung');
