import { useDB } from './db';
import { createPlanFromImport, newEmployee, planByDate, planPauses, planShifts, saveEmployee, saveSettings } from './actions';
import { commit, type Change } from './db';
import { nameKey, todayISO } from '../lib/time';
import type { Employee } from '../lib/types';

const t = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** Testplan nach den Vorgaben der Filiale (Namen MA 1–14). */
export const TESTPLAN: { name: string; start: string; end: string; profile?: Partial<Employee> }[] = [
  { name: 'MA 1', start: '05:30', end: '14:30', profile: { pause_group: 'Öffner' } },
  { name: 'MA 2', start: '05:30', end: '14:30', profile: { pause_group: 'Öffner' } },
  { name: 'MA 3', start: '06:30', end: '15:30' },
  { name: 'MA 4', start: '07:00', end: '16:00' },
  { name: 'MA 5', start: '07:30', end: '16:30' },
  { name: 'MA 6', start: '08:00', end: '13:30' },
  { name: 'MA 7', start: '08:00', end: '14:00' },
  { name: 'MA 8', start: '08:30', end: '12:30' },
  { name: 'MA 9', start: '09:30', end: '18:30' },
  { name: 'MA 10', start: '10:00', end: '19:00' },
  { name: 'MA 11', start: '10:00', end: '19:00' },
  { name: 'MA 12', start: '11:30', end: '19:00' },
  { name: 'MA 13', start: '11:30', end: '19:00', profile: { pause_model: 'flexible_custom', custom_block_count: 2, custom_block_minutes: 15 } },
  { name: 'MA 14', start: '11:00', end: '19:00' },
];

/**
 * Nur Demo/lokaler Modus: setzt die Pausenregeln der Filiale, legt MA 1–14 mit Profilen an
 * und erstellt (bzw. ersetzt) den Tagesplan für das Datum inkl. automatischer Pausenplanung.
 */
export function loadTestPlan(date = todayISO()): string {
  saveSettings({
    max_concurrent_pauses: 3,
    capacity_rules: [{ from: t('14:30'), max: 2 }],
    pause_grid_min: 30,
    latest_pause_start: t('15:30'),
    min_after_start_min: 90,
    min_between_blocks_min: 90,
    min_before_end_min: 60,
    length_rules: [
      { from: 0, count: 0, minutes: 30 },
      { from: 6 * 60, count: 1, minutes: 30 },
      { from: 9 * 60, count: 2, minutes: 30 },
    ],
    start_rules: [
      { start: t('09:30'), first: t('11:30') },
      { start: t('10:00'), first: t('12:00') },
    ],
  });

  // Mitarbeiter mit Profilen anlegen bzw. auf die Vorgaben zurücksetzen
  const employees = Object.values(useDB.getState().employees).filter((e) => !e.deleted_at);
  for (const row of TESTPLAN) {
    const existing = employees.find((e) => e.name_key === nameKey(row.name));
    const base = existing ?? newEmployee(row.name);
    saveEmployee({ ...base, pause_model: 'standard', pause_group: null, custom_block_count: 2, custom_block_minutes: 15, ...row.profile, active: true });
  }

  // bestehenden Plan des Tages (Demo) entfernen
  const s = useDB.getState();
  const old = planByDate(date, s);
  if (old) {
    const ts = new Date().toISOString();
    const changes: Change[] = [{ table: 'daily_plans', row: { ...old, deleted_at: ts } }];
    planShifts(old.id, s).forEach((row) => changes.push({ table: 'shift_entries', row: { ...row, deleted_at: ts } }));
    planPauses(old.id, s).forEach((row) => changes.push({ table: 'pause_blocks', row: { ...row, deleted_at: ts } }));
    commit(changes);
    useDB.setState((st) => ({ undo: st.undo.filter((u) => u.planId !== old.id) }));
  }

  return createPlanFromImport(date, TESTPLAN.map((r) => ({ name: r.name, start: t(r.start), end: t(r.end) })), 'Testplan MA 1–14', false);
}
