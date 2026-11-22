import { describe, expect, it } from 'vitest';
import { schedulePauses } from '../scheduler';
import { validatePlan } from '../validation';
import { DEFAULT_SETTINGS, type PauseBlock, type ShiftEntry } from '../types';
import { fmtMin } from '../time';

/**
 * Filialtag 05:30–19:00 mit 14 Mitarbeitern:
 * 2 öffnen um 05:30, weitere ab 06:30/07:00 (Ladenöffnung 07:00),
 * Ladenschluss 18:30, 5 bleiben bis 19:00 zum Putzen.
 * Letzte Pause startet spätestens 15:30, max. 4 gleichzeitig.
 */
const t = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const FILIALTAG_14: [string, string, string][] = [
  ['MA 1', '05:30', '13:30'], ['MA 2', '05:30', '13:30'],
  ['MA 3', '06:30', '14:30'], ['MA 4', '06:30', '14:30'],
  ['MA 5', '07:00', '15:00'], ['MA 6', '07:00', '15:00'],
  ['MA 7', '08:00', '16:00'], ['MA 8', '09:00', '17:00'], ['MA 9', '10:00', '18:00'],
  ['MA 10', '11:00', '19:00'], ['MA 11', '11:00', '19:00'], ['MA 12', '11:00', '19:00'], ['MA 13', '11:00', '19:00'], ['MA 14', '11:00', '19:00'],
];

describe('Filialtag 14 MA, 05:30–19:00, letzte Pause 15:30', () => {
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
    expect(max).toBeLessThanOrEqual(4);
  });
});
