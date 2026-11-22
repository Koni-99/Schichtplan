-- =====================================================================
-- Mitarbeiter "Aus Plan entfernen" (Filialleitung) mit Vermerk für die Personalleitung
-- Der Eintrag wird NICHT gelöscht, sondern erhält status = 'removed' plus Grund,
-- Zeitpunkt und Namen. So bleibt er im Soll/Ist-Bericht sichtbar.
-- =====================================================================

alter type shift_status add value if not exists 'removed';

alter table public.shift_entries
  add column if not exists removed_reason  text,
  add column if not exists removed_at      timestamptz,
  add column if not exists removed_by_name text;

-- Nur die Filialleitung darf Einträge entfernen oder wiederherstellen
create or replace function public.guard_shift_removal() returns trigger
language plpgsql as $$
begin
  if public.auth_role() is not null                       -- Cron/Service-Kontext ausgenommen
     and public.auth_role() <> 'filialleitung'
     and ((new.status::text = 'removed') is distinct from (old.status::text = 'removed')
          or new.removed_reason is distinct from old.removed_reason) then
    raise exception 'Nur die Filialleitung darf Mitarbeiter aus dem Plan entfernen oder wiederherstellen';
  end if;
  if new.status::text = 'removed' and coalesce(btrim(new.removed_reason), '') = '' then
    raise exception 'Beim Entfernen aus dem Plan ist ein Grund erforderlich';
  end if;
  return new;
end $$;

drop trigger if exists guard_shift_removal on public.shift_entries;
create trigger guard_shift_removal before update on public.shift_entries
  for each row execute function public.guard_shift_removal();
