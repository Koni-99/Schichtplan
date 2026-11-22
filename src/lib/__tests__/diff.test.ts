import { describe, expect, it } from 'vitest';
import { diffShift } from '../diff';
import { buildCsv } from '../export';
import { DEFAULT_SETTINGS, type DailyPlan, type ShiftEntry } from '../types';

const shift: ShiftEntry = {
  id: 's1', plan_id: 'p', employee_id: null, employee_name: 'Müller, Anna', planned_start_min: 360, planned_end_min: 870,
  actual_start_min: null, actual_end_min: null, planned_pause_min: 60, actual_pause_min: 0, status: 'removed',
  removed_reason: 'Fehler im PEPZeit-Plan', removed_at: '2026-11-23T08:15:00Z', removed_by_name: 'Filialleitung',
  is_manual: false, note: '', sort_order: 0, created_at: '', updated_at: '', deleted_at: null,
};

describe('Aus Plan entfernt', () => {
  it('erscheint als Abweichung mit Grund und ohne Ist-Zeiten', () => {
    const d = diffShift(shift, [], DEFAULT_SETTINGS);
    expect(d.kinds).toEqual(['removed']);
    expect(d.istStart).toBeNull();
    expect(d.summary[0]).toContain('Aus Plan entfernt: Fehler im PEPZeit-Plan (Filialleitung');
  });
  it('steht mit Grund im CSV-Export', () => {
    const plan = { id: 'p', plan_date: '2026-11-23', status: 'closed', closed_label: 'x' } as DailyPlan;
    const csv = buildCsv([{ plan, shifts: [shift], pauses: [] }], DEFAULT_SETTINGS);
    expect(csv).toContain('Aus Plan entfernt;');
    expect(csv).toContain('Aus Plan entfernt: Fehler im PEPZeit-Plan');
  });
});
