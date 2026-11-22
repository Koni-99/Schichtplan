import { describe, expect, it } from 'vitest';
import { schedulePauses } from '../scheduler';
import { validatePlan } from '../validation';
import { DEFAULT_SETTINGS, type Employee, type PauseBlock, type ShiftEntry } from '../types';

const t = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
let n = 0;
function shift(name: string, start: string, end: string, employee_id: string | null = null): ShiftEntry {
  return { id: `s${++n}`, plan_id: 'p', employee_id, employee_name: name, planned_start_min: t(start), planned_end_min: t(end), actual_start_min: null, actual_end_min: null, planned_pause_min: 0, actual_pause_min: null, status: 'present', is_manual: false, note: '', sort_order: n, created_at: '', updated_at: '', deleted_at: null };
}
function emp(id: string, patch: Partial<Employee>): Employee {
  return { id, name: id, name_key: id, pause_model: 'standard', custom_block_count: 2, custom_block_minutes: 15, fixed_starts: [], fixed_block_minutes: 30, active: true, created_at: '', updated_at: '', deleted_at: null, ...patch };
}
const toBlocks = (r: ReturnType<typeof schedulePauses>): PauseBlock[] =>
  r.blocks.map((b, i) => ({ id: `b${i}`, plan_id: 'p', shift_entry_id: b.shiftId, block_no: b.blockNo, start_min: b.start, planned_duration_min: b.duration, is_fixed: b.isFixed, status: 'open', actual_start_at: null, actual_end_at: null, actual_duration_min: null, created_at: '', updated_at: '', deleted_at: null }));

describe('schedulePauses', () => {
  it('plant 2 × 30 Min. innerhalb der Abstandsregeln', () => {
    const s = shift('Anna', '06:00', '14:30');
    const r = schedulePauses({ shifts: [s], pauses: [], employees: {}, settings: DEFAULT_SETTINGS });
    expect(r.blocks).toHaveLength(2);
    const [b1, b2] = r.blocks.sort((a, b) => a.blockNo - b.blockNo);
    expect(b1.duration).toBe(30);
    expect(b1.start).toBeGreaterThanOrEqual(t('07:30'));
    expect(b2.start - (b1.start + 30)).toBeGreaterThanOrEqual(90);
    expect(b2.start + 30).toBeLessThanOrEqual(t('13:30'));
    expect(r.plannedPauseByShift[s.id]).toBe(60);
  });

  it('keine Pause bei Kurzschicht und bei Profil "Keine Pause"', () => {
    const a = shift('Kurz', '06:00', '10:00');
    const b = shift('Ohne', '06:00', '14:00', 'e1');
    const r = schedulePauses({ shifts: [a, b], pauses: [], employees: { e1: emp('e1', { pause_model: 'none' }) }, settings: DEFAULT_SETTINGS });
    expect(r.blocks).toHaveLength(0);
  });

  it('setzt feste Uhrzeiten und Sondermodelle', () => {
    const a = shift('Fix', '06:00', '14:30', 'f');
    const b = shift('Sonder', '06:00', '14:30', 'c');
    const employees = { f: emp('f', { pause_model: 'fixed', fixed_starts: [600, 810] }), c: emp('c', { pause_model: 'flexible_custom', custom_block_count: 1, custom_block_minutes: 30 }) };
    const r = schedulePauses({ shifts: [a, b], pauses: [], employees, settings: DEFAULT_SETTINGS });
    const fix = r.blocks.filter((x) => x.shiftId === a.id).map((x) => x.start);
    expect(fix).toEqual([600, 810]);
    expect(r.blocks.filter((x) => x.shiftId === b.id)).toHaveLength(1);
  });

  it('hält max. 4 gleichzeitig ein – auch bei 20 identischen Schichten', () => {
    const shifts = Array.from({ length: 20 }, (_, i) => shift(`MA${i}`, '06:00', '14:30'));
    const r = schedulePauses({ shifts, pauses: [], employees: {}, settings: DEFAULT_SETTINGS });
    expect(r.blocks).toHaveLength(40);
    const v = validatePlan(shifts, toBlocks(r), {}, DEFAULT_SETTINGS);
    expect(v.overCapacity).toEqual([]);
    expect(r.warnings.filter((w) => w.includes('Kapazität'))).toEqual([]);
  });

  it('meldet Überlastung, wenn die Kapazität physisch nicht reicht', () => {
    const shifts = Array.from({ length: 12 }, (_, i) => shift(`MA${i}`, '06:00', '10:00'));
    const cfg = { ...DEFAULT_SETTINGS, short_shift_threshold_min: 0, max_concurrent_pauses: 1 };
    const r = schedulePauses({ shifts, pauses: [], employees: {}, settings: cfg });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('erkennt Soft-Warnings bei manueller Überbuchung', () => {
    const shifts = Array.from({ length: 5 }, (_, i) => shift(`MA${i}`, '06:00', '14:30'));
    const blocks = toBlocks(schedulePauses({ shifts, pauses: [], employees: {}, settings: DEFAULT_SETTINGS }));
    blocks.forEach((b) => { if (b.block_no === 1) b.start_min = t('09:00'); });
    const v = validatePlan(shifts, blocks, {}, DEFAULT_SETTINGS);
    expect(v.overCapacity.length).toBeGreaterThan(0);
  });
});

describe('§ 4 ArbZG – max. 6 Std. am Stück', () => {
  it('warnt, wenn Pausen so verschoben sind, dass über 6 Std. ohne Pause entstehen', () => {
    const s = shift('Lang', '06:00', '16:30');
    const blocks = toBlocks(schedulePauses({ shifts: [s], pauses: [], employees: {}, settings: DEFAULT_SETTINGS }));
    blocks[0].start_min = t('07:30'); blocks[1].start_min = t('08:30');
    const v = validatePlan([s], blocks, {}, DEFAULT_SETTINGS);
    expect(v.byShift[s.id]?.some((i) => i.text.includes('Mehr als 6 Std.'))).toBe(true);
  });
  it('Auto-Planung hält die 6-Std.-Grenze auch bei langen Schichten und Engpässen ein', () => {
    const shifts = Array.from({ length: 16 }, (_, i) => shift(`MA${i}`, '06:00', '19:00'));
    const cfg = { ...DEFAULT_SETTINGS, default_block_count: 2, default_block_minutes: 30 };
    const blocks = toBlocks(schedulePauses({ shifts, pauses: [], employees: {}, settings: cfg }));
    const v = validatePlan(shifts, blocks, {}, cfg);
    const stretch = Object.values(v.byShift).flat().filter((i) => i.text.includes('Mehr als 6 Std.'));
    expect(stretch).toEqual([]);
  });
  it('Bericht zeigt Verstoß, wenn tatsächlich keine Pause genommen wurde', async () => {
    const { diffShift } = await import('../diff');
    const s = { ...shift('Ohne', '06:00', '14:30'), planned_pause_min: 60, actual_pause_min: 0 };
    expect(diffShift(s, [], DEFAULT_SETTINGS).kinds).toContain('arbzg');
  });
});
