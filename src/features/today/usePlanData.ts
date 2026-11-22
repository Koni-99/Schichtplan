import { useMemo } from 'react';
import { useDB } from '../../store/db';
import { validatePlan } from '../../lib/validation';
import type { PauseBlock, ShiftEntry } from '../../lib/types';

/** Alle Daten eines Plans (stabile Referenzen für zustand v5). */
export function usePlanData(planId: string | undefined, now?: Date) {
  const plans = useDB((s) => s.plans);
  const shiftsAll = useDB((s) => s.shifts);
  const pausesAll = useDB((s) => s.pauses);
  const employees = useDB((s) => s.employees);
  const settings = useDB((s) => s.settings);

  const plan = planId ? plans[planId] : undefined;
  const shifts = useMemo<ShiftEntry[]>(
    () =>
      planId
        ? Object.values(shiftsAll)
            .filter((x) => x.plan_id === planId && !x.deleted_at)
            .sort((a, b) => (a.actual_start_min ?? a.planned_start_min ?? 0) - (b.actual_start_min ?? b.planned_start_min ?? 0) || a.sort_order - b.sort_order)
        : [],
    [shiftsAll, planId],
  );
  const pauses = useMemo<PauseBlock[]>(() => (planId ? Object.values(pausesAll).filter((x) => x.plan_id === planId && !x.deleted_at) : []), [pausesAll, planId]);
  // Minute-genaue Neuberechnung reicht für Warnungen
  const minuteKey = now ? Math.floor(now.getTime() / 60000) : 0;
  const issues = useMemo(() => validatePlan(shifts, pauses, employees, settings, now), [shifts, pauses, employees, settings, minuteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pausesByShift = useMemo(() => {
    const m = new Map<string, PauseBlock[]>();
    for (const p of pauses) (m.get(p.shift_entry_id) ?? m.set(p.shift_entry_id, []).get(p.shift_entry_id)!).push(p);
    for (const list of m.values()) list.sort((a, b) => a.block_no - b.block_no);
    return m;
  }, [pauses]);
  return { plan, shifts, pauses, pausesByShift, employees, settings, issues };
}
