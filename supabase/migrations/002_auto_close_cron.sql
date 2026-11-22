-- =====================================================================
-- Automatischer Tagesabschluss (Standard 19:30 Uhr, konfigurierbar)
--
-- pg_cron läuft in UTC. Deshalb läuft der Job alle 5 Minuten und die
-- Funktion prüft selbst anhand von settings.timezone (Europe/Berlin) und
-- settings.auto_close_time, ob ein offener Plan fällig ist. Dadurch sind
-- Sommer-/Winterzeit und eine geänderte Uhrzeit automatisch berücksichtigt.
-- Pläne vergangener Tage, die noch offen sind, werden ebenfalls geschlossen.
-- =====================================================================

create extension if not exists pg_cron;

-- Prüft, ob ein Plan Soll/Ist-Abweichungen enthält (gleiche Regeln wie im Client, src/lib/diff.ts)
create or replace function public.plan_has_deviations(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shift_entries s
    where s.plan_id = p_plan and s.deleted_at is null and (
         s.status <> 'present'
      or s.is_manual
      or coalesce(btrim(s.note), '') <> ''
      or (s.actual_start_min is not null and s.actual_start_min is distinct from s.planned_start_min)
      or (s.actual_end_min   is not null and s.actual_end_min   is distinct from s.planned_end_min)
      or coalesce(s.actual_pause_min, 0) <> s.planned_pause_min
    )
  )
$$;

-- Schließt einen einzelnen Plan ab (für Cron und optional per RPC nutzbar)
create or replace function public.close_plan(p_plan uuid, p_type closed_type, p_label text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cfg public.settings;
  v_now timestamptz := now();
begin
  select * into cfg from public.settings where id = 1;

  -- 1) Laufende Pausen beenden (Ist-Dauer = bisher vergangene Zeit, max. bis jetzt)
  update public.pause_blocks
     set status = 'done',
         actual_end_at = v_now,
         actual_duration_min = greatest(1, round(extract(epoch from (v_now - actual_start_at)) / 60))::smallint,
         updated_at = v_now
   where plan_id = p_plan and deleted_at is null and status = 'running';

  -- 2) Ist-Gesamtpause je Schicht einfrieren
  update public.shift_entries s
     set actual_pause_min = coalesce((
           select sum(case
                        when b.status = 'done' then coalesce(b.actual_duration_min, b.planned_duration_min)
                        when b.status = 'open' and cfg.count_unstarted_as_taken and s.status <> 'sick'
                             then b.planned_duration_min
                        else 0 end)
             from public.pause_blocks b
            where b.shift_entry_id = s.id and b.deleted_at is null), 0)::smallint,
         updated_at = v_now
   where s.plan_id = p_plan and s.deleted_at is null;

  -- 3) Plan schließen und für die Personalleitung als ungelesen markieren
  update public.daily_plans
     set status = 'closed',
         closed_at = v_now,
         closed_type = p_type,
         closed_label = p_label,
         is_read_by_hr = false,
         has_deviations = public.plan_has_deviations(p_plan),
         updated_at = v_now
   where id = p_plan and status = 'open';
end $$;

-- Wird vom Cron-Job aufgerufen
create or replace function public.close_due_plans() returns integer
language plpgsql security definer set search_path = public as $$
declare
  cfg public.settings;
  v_local timestamp;
  v_today date;
  v_minute int;
  v_label text;
  r record;
  n int := 0;
begin
  select * into cfg from public.settings where id = 1;
  if not cfg.auto_close_enabled then
    return 0;
  end if;

  v_local  := now() at time zone cfg.timezone;
  v_today  := v_local::date;
  v_minute := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_label  := format('Automatisch abgeschlossen um %s Uhr',
                     lpad((cfg.auto_close_time / 60)::text, 2, '0') || ':' || lpad((cfg.auto_close_time % 60)::text, 2, '0'));

  for r in
    select id from public.daily_plans
     where status = 'open' and deleted_at is null
       and (plan_date < v_today or (plan_date = v_today and v_minute >= cfg.auto_close_time))
  loop
    perform public.close_plan(r.id, 'auto', v_label);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Nur der Cron-/Service-Kontext darf das ausführen
revoke all on function public.close_due_plans() from public, anon, authenticated;
revoke all on function public.close_plan(uuid, closed_type, text) from public, anon, authenticated;

-- Cron-Job anlegen (idempotent)
do $$
begin
  perform cron.unschedule('pausenplaner-auto-close')
   where exists (select 1 from cron.job where jobname = 'pausenplaner-auto-close');
end $$;

select cron.schedule(
  'pausenplaner-auto-close',
  '*/5 * * * *',
  $$ select public.close_due_plans(); $$
);
