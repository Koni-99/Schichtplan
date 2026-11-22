import { blockSpan, capacityArray, isActiveBlock, longestStretch, pauseGrid, MAX_STRETCH_MIN, requiredPauseMinutes, shiftWindow } from './pauseRules';
import type { Employee, PauseBlock, Settings, ShiftEntry } from './types';
import { fmtMin } from './time';

export type Severity = 'error' | 'warn';
export interface Issue {
  severity: Severity;
  text: string;
}

export interface PlanIssues {
  byBlock: Record<string, Issue[]>;
  byShift: Record<string, Issue[]>;
  /** Zeiträume, in denen die Kapazitätsgrenze überschritten ist */
  overCapacity: { from: number; to: number; count: number }[];
  total: number;
}

/** Soft-Warnings: nichts wird blockiert, aber alles Regelwidrige wird markiert. */
export function validatePlan(shifts: ShiftEntry[], pauses: PauseBlock[], employees: Record<string, Employee>, cfg: Settings, now?: Date): PlanIssues {
  const res: PlanIssues = { byBlock: {}, byShift: {}, overCapacity: [], total: 0 };
  const push = (map: Record<string, Issue[]>, id: string, issue: Issue) => {
    (map[id] ??= []).push(issue);
    res.total++;
  };
  const shiftById = new Map(shifts.filter((s) => !s.deleted_at).map((s) => [s.id, s]));
  const active = pauses.filter((p) => isActiveBlock(p) && shiftById.has(p.shift_entry_id) && shiftWindow(shiftById.get(p.shift_entry_id)!));

  // Kapazität
  const occ = new Int16Array(24 * 60 + 240);
  const cap = capacityArray(cfg, occ.length);
  const spans = active.map((p) => ({ p, ...blockSpan(p, now) }));
  for (const s of spans) for (let m = Math.max(0, s.from); m < Math.min(occ.length, s.to); m++) occ[m]++;
  let runStart = -1, runMax = 0;
  for (let m = 0; m <= occ.length; m++) {
    const over = m < occ.length && occ[m] > cap[m];
    if (over) {
      if (runStart < 0) runStart = m;
      runMax = Math.max(runMax, occ[m]);
    } else if (runStart >= 0) {
      res.overCapacity.push({ from: runStart, to: m, count: runMax });
      runStart = -1;
      runMax = 0;
    }
  }
  for (const s of spans) {
    let mx = 0, limit = Infinity;
    for (let m = Math.max(0, s.from); m < Math.min(occ.length, s.to); m++) {
      if (occ[m] > cap[m] && occ[m] - cap[m] >= mx - limit) { mx = occ[m]; limit = cap[m]; }
    }
    if (mx > limit) {
      push(res.byBlock, s.p.id, { severity: 'error', text: `${mx} gleichzeitig in Pause (max. ${limit})` });
    }
  }

  // Regeln je Schicht
  for (const shift of shiftById.values()) {
    const win = shiftWindow(shift);
    if (!win) continue;
    const own = active.filter((p) => p.shift_entry_id === shift.id).sort((a, b) => a.start_min - b.start_min);
    const emp = shift.employee_id ? employees[shift.employee_id] : undefined;
    const soll = requiredPauseMinutes(emp, shift, cfg);
    const planned = own.reduce((a, p) => a + (p.status === 'done' ? p.actual_duration_min ?? p.planned_duration_min : p.planned_duration_min), 0);
    if (planned < soll) {
      push(res.byShift, shift.id, { severity: 'error', text: `Pausenzeit unter Soll (${planned} / ${soll} Min.)` });
    }
    if (win.end - win.start > MAX_STRETCH_MIN) {
      const st = longestStretch(win, own.map((p) => blockSpan(p, now)));
      if (st.length > MAX_STRETCH_MIN) {
        push(res.byShift, shift.id, { severity: 'error', text: `Mehr als 6 Std. am Stück ohne Pause (${fmtMin(st.from)}–${fmtMin(st.to)}, ${Math.floor(st.length / 60)}:${String(st.length % 60).padStart(2, '0')} Std.) – ArbZG § 4` });
      }
    }
    own.forEach((p, i) => {
      const span = blockSpan(p, now);
      if (span.from < win.start || span.to > win.end) {
        push(res.byBlock, p.id, { severity: 'error', text: `Außerhalb der Arbeitszeit (${fmtMin(win.start)}–${fmtMin(win.end)})` });
        return;
      }
      if (p.is_fixed) return; // feste Uhrzeiten sind gewollt
      if (i === 0 && p.start_min < win.start + cfg.min_after_start_min) {
        push(res.byBlock, p.id, { severity: 'warn', text: `Früher als ${cfg.min_after_start_min / 60} Std. nach Schichtbeginn` });
      }
      if (i > 0) {
        const prev = blockSpan(own[i - 1], now);
        if (p.start_min - prev.to < cfg.min_between_blocks_min) {
          push(res.byBlock, p.id, { severity: 'warn', text: `Abstand zu Block ${own[i - 1].block_no} unter ${cfg.min_between_blocks_min / 60} Std.` });
        }
      }
      const grid = pauseGrid(cfg);
      if (grid > 5 && p.status === 'open' && p.start_min % grid !== 0) {
        push(res.byBlock, p.id, { severity: 'warn', text: grid === 30 ? 'Beginnt nicht zur vollen oder halben Stunde' : `Beginnt nicht im ${grid}-Minuten-Raster` });
      }
      if (cfg.latest_pause_start != null && p.start_min > cfg.latest_pause_start && p.status === 'open') {
        push(res.byBlock, p.id, { severity: 'warn', text: `Startet nach ${fmtMin(cfg.latest_pause_start)} (letzte Pausenzeit)` });
      }
      if (i === own.length - 1 && span.to > win.end - cfg.min_before_end_min) {
        push(res.byBlock, p.id, { severity: 'warn', text: `Später als ${cfg.min_before_end_min / 60} Std. vor Schichtende` });
      }
    });
  }
  return res;
}
