import { describe, expect, it } from 'vitest';
import { schedulePauses } from '../scheduler';
import { validatePlan } from '../validation';
import { DEFAULT_SETTINGS, type Employee, type PauseBlock, type ShiftEntry } from '../types';
import { fmtMin } from '../time';
import { capacityAt } from '../pauseRules';

/**
 * Filialtag 05:30–19:00 mit 14 Mitarbeitern (Vorgaben der Filiale):
 * - MA 1 & 2 öffnen um 05:30 und gehen immer gemeinsam in Pause (Pausengruppe)
 * - bis 08:00 max. 5 Personen; 08:00 zwei, 08:30 eine; 5 bleiben bis 19:00 zum Putzen
 * - Pausenlänge nach Schichtlänge: < 6 Std. keine, ab 6 Std. 1 × 30, ab 9 Std. 2 × 30
 * - Schicht ab 09:30 → 1. Pause 11:30, Schicht ab 10:00 → 1. Pause 12:00
 * - MA 13 individuell 2 × 15 Min.
 * - Pausen nur zur vollen/halben Stunde, letzte Pause spätestens 15:30,
 *   max. 3 gleichzeitig, ab 14:30 max. 2
 */
const t = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const FILIALTAG_14: [string, string, string][] = [
  ['MA 1', '05:30', '14:30'], ['MA 2', '05:30', '14:30'],
  ['MA 3', '06:30', '15:30'],
  ['MA 4', '07:00', '16:00'], ['MA 5', '07:30', '16:30'],
  ['MA 6', '08:00', '13:30'], ['MA 7', '08:00', '14:00'],
  ['MA 8', '08:30', '12:30'],
  ['MA 9', '09:30', '18:30'],
  ['MA 10', '10:00', '19:00'], ['MA 11', '10:00', '19:00'],
  ['MA 12', '11:30', '19:00'], ['MA 13', '11:30', '19:00'], ['MA 14', '11:00', '19:00'],
];

const emp = (id: string, patch: Partial<Employee>): Employee => ({
  id, name: id, name_key: id, pause_model: 'standard', custom_block_count: 2, custom_block_minutes: 15, fixed_starts: [], fixed_block_minutes: 30,
  active: true, created_at: '', updated_at: '', deleted_at: null, ...patch,
});
const employees: Record<string, Employee> = {
  'MA 1': emp('MA 1', { pause_group: 'Öffner' }),
  'MA 2': emp('MA 2', { pause_group: 'Öffner' }),
  'MA 13': emp('MA 13', { pause_model: 'flexible_custom', custom_block_count: 2, custom_block_minutes: 15 }),
};

describe('Filialtag 14 MA nach Vorgaben der Filiale', () => {
  const shifts: ShiftEntry[] = FILIALTAG_14.map(([n, a, e], i) => ({
    id: `s${i}`, plan_id: 'p', employee_id: employees[n] ? n : null, employee_name: n, planned_start_min: t(a), planned_end_min: t(e), actual_start_min: null, actual_end_min: null,
    planned_pause_min: 0, actual_pause_min: null, status: 'present', is_manual: false, note: '', sort_order: i, created_at: '', updated_at: '', deleted_at: null,
  }));
  const r = schedulePauses({ shifts, pauses: [], employees, settings: DEFAULT_SETTINGS });
  const blocks: PauseBlock[] = r.blocks.map((b, i) => ({ id: `b${i}`, plan_id: 'p', shift_entry_id: b.shiftId, block_no: b.blockNo, start_min: b.start, planned_duration_min: b.duration, is_fixed: b.isFixed, status: 'open', actual_start_at: null, actual_end_at: null, actual_duration_min: null, created_at: '', updated_at: '', deleted_at: null }));
  const of = (name: string) => blocks.filter((b) => shifts.find((s) => s.id === b.shift_entry_id)!.employee_name === name).sort((a, b) => a.block_no - b.block_no);

  it('erfüllt alle Vorgaben', () => {
    const v = validatePlan(shifts, blocks, employees, DEFAULT_SETTINGS);
    console.log(shifts.map((s) => `${s.employee_name.padEnd(6)} ${fmtMin(s.planned_start_min)}–${fmtMin(s.planned_end_min)}  ${of(s.employee_name).map((b) => `${fmtMin(b.start_min)}–${fmtMin(b.start_min + b.planned_duration_min)}`).join('  ') || 'keine Pause'}`).join('\n'));
    console.log('Warnungen:', r.warnings, '| Hinweise:', v.total, JSON.stringify(v.byBlock), JSON.stringify(v.byShift));
    expect(r.warnings).toEqual([]);
    expect(v.total).toBe(0);
    // Pausenanzahl/-länge je Schicht
    expect(of('MA 6')).toHaveLength(0);
    expect(of('MA 8')).toHaveLength(0);
    expect(of('MA 7').map((b) => b.planned_duration_min)).toEqual([30]);
    expect(of('MA 12').map((b) => b.planned_duration_min)).toEqual([30]);
    expect(of('MA 14').map((b) => b.planned_duration_min)).toEqual([30]);
    expect(of('MA 13').map((b) => b.planned_duration_min)).toEqual([15, 15]);
    expect(of('MA 3').map((b) => b.planned_duration_min)).toEqual([30, 30]);
    // feste erste Pausen
    expect(of('MA 9')[0].start_min).toBe(t('11:30'));
    expect(of('MA 10')[0].start_min).toBe(t('12:00'));
    expect(of('MA 11')[0].start_min).toBe(t('12:00'));
    // MA 1 & 2 gemeinsam
    expect(of('MA 1').map((b) => b.start_min)).toEqual(of('MA 2').map((b) => b.start_min));
    // Raster, Kapazität, letzte Pause
    expect(blocks.every((b) => b.start_min % 30 === 0)).toBe(true);
    expect(Math.max(...blocks.map((b) => b.start_min))).toBeLessThanOrEqual(t('15:30'));
    for (let m = 0; m < 1440; m++) {
      const n = blocks.filter((b) => m >= b.start_min && m < b.start_min + b.planned_duration_min).length;
      expect(n, `um ${fmtMin(m)}`).toBeLessThanOrEqual(capacityAt(DEFAULT_SETTINGS, m));
    }
    const present = (m: number) => shifts.filter((s) => m >= s.planned_start_min! && m < s.planned_end_min!).length;
    expect(present(t('07:59'))).toBeLessThanOrEqual(5);
    expect(present(t('18:45'))).toBe(5);
    const onBreak = (m: number) => blocks.filter((b) => m >= b.start_min && m < b.start_min + b.planned_duration_min).length;
    console.log('Pausen um 15:30:', blocks.filter((b) => b.start_min === t('15:30')).length,
      '| min. an der Theke 07:00–18:30:', Math.min(...Array.from({ length: t('18:30') - t('07:00') }, (_, i) => present(t('07:00') + i) - onBreak(t('07:00') + i))));
  });
});
