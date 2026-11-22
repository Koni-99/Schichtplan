import { describe, expect, it } from 'vitest';
import { schedulePauses } from '../scheduler';
import { validatePlan } from '../validation';
import { DEFAULT_SETTINGS, type PauseBlock, type ShiftEntry } from '../types';
import { fmtMin } from '../time';
import { capacityAt } from '../pauseRules';

/**
 * Filialtag 05:30–19:00 mit 14 Mitarbeitern, Schichten à 9 Std. (8 Std. Arbeit + 2 × 30 Min. Pause):
 * 05:30 zwei Öffner, 06:30 eine Person, 07:00 und 07:30 je eine (bis 08:00 max. 5),
 * 08:00 zwei, 08:30 eine, Spätschicht ab 09:30/10:00, 5 bleiben bis 19:00 zum Putzen.
 * Pausen nur zur vollen/halben Stunde, letzte Pause spätestens 15:30,
 * max. 3 gleichzeitig, ab 14:30 max. 2, um 15:30 möglichst nur 1.
 */
const t = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const FILIALTAG_14: [string, string, string][] = [
  ['MA 1', '05:30', '14:30'], ['MA 2', '05:30', '14:30'],
  ['MA 3', '06:30', '15:30'],
  ['MA 4', '07:00', '16:00'], ['MA 5', '07:30', '16:30'],
  ['MA 6', '08:00', '17:00'], ['MA 7', '08:00', '17:00'],
  ['MA 8', '08:30', '17:30'],
  ['MA 9', '09:30', '18:30'],
  ['MA 10', '10:00', '19:00'], ['MA 11', '10:00', '19:00'], ['MA 12', '10:00', '19:00'], ['MA 13', '10:00', '19:00'], ['MA 14', '10:00', '19:00'],
];

describe('Filialtag 14 MA, 05:30–19:00, 9-Std.-Schichten, Raster :00/:30, max. 3 bzw. 2 ab 14:30', () => {
  const shifts: ShiftEntry[] = FILIALTAG_14.map(([n, a, e], i) => ({
    id: `s${i}`, plan_id: 'p', employee_id: null, employee_name: n, planned_start_min: t(a), planned_end_min: t(e), actual_start_min: null, actual_end_min: null,
    planned_pause_min: 0, actual_pause_min: null, status: 'present', is_manual: false, note: '', sort_order: i, created_at: '', updated_at: '', deleted_at: null,
  }));
  const r = schedulePauses({ shifts, pauses: [], employees: {}, settings: DEFAULT_SETTINGS });
  const blocks: PauseBlock[] = r.blocks.map((b, i) => ({ id: `b${i}`, plan_id: 'p', shift_entry_id: b.shiftId, block_no: b.blockNo, start_min: b.start, planned_duration_min: b.duration, is_fixed: false, status: 'open', actual_start_at: null, actual_end_at: null, actual_duration_min: null, created_at: '', updated_at: '', deleted_at: null }));

  it('erfüllt alle Regeln', () => {
    const v = validatePlan(shifts, blocks, {}, DEFAULT_SETTINGS);
    const table = shifts.map((s) => {
      const own = blocks.filter((b) => b.shift_entry_id === s.id).sort((a, b) => a.block_no - b.block_no);
      return `${s.employee_name.padEnd(6)} ${fmtMin(s.planned_start_min)}–${fmtMin(s.planned_end_min)}  ${own.map((b) => `${fmtMin(b.start_min)}–${fmtMin(b.start_min + b.planned_duration_min)}`).join('  ')}`;
    });
    console.log(table.join('\n'));
    let max = 0;
    for (let m = 0; m < 1440; m++) max = Math.max(max, blocks.filter((b) => m >= b.start_min && m < b.start_min + b.planned_duration_min).length);
    console.log('max. gleichzeitig:', max, '| Warnungen:', r.warnings, '| Hinweise:', v.total);
    expect(r.warnings).toEqual([]);
    expect(v.total).toBe(0);
    expect(blocks).toHaveLength(28);
    expect(Math.max(...blocks.map((b) => b.start_min))).toBeLessThanOrEqual(t('15:30'));
    for (let m = 0; m < 1440; m++) {
      const n = blocks.filter((b) => m >= b.start_min && m < b.start_min + b.planned_duration_min).length;
      expect(n, `um ${fmtMin(m)}`).toBeLessThanOrEqual(capacityAt(DEFAULT_SETTINGS, m));
    }
    expect(blocks.every((b) => b.start_min % 30 === 0)).toBe(true);
    const at1530 = blocks.filter((b) => b.start_min === t('15:30')).length;
    console.log('Pausen um 15:30:', at1530);
    expect(at1530).toBeLessThanOrEqual(2);
    // Besetzung: bis 08:00 höchstens 5 Personen da, ab 18:30 genau 5
    const present = (m: number) => shifts.filter((s) => m >= s.planned_start_min! && m < s.planned_end_min!).length;
    expect(present(t('07:59'))).toBeLessThanOrEqual(5);
    expect(present(t('18:45'))).toBe(5);
    const onBreak = (m: number) => blocks.filter((b) => m >= b.start_min && m < b.start_min + b.planned_duration_min).length;
    const minAtCounter = Math.min(...Array.from({ length: t('18:30') - t('07:00') }, (_, i) => present(t('07:00') + i) - onBreak(t('07:00') + i)));
    console.log('min. an der Theke (07:00–18:30):', minAtCounter);
  });
});
