import { blockSpan, isActiveBlock, requiredBlocks, shiftWindow, type BlockRequirement } from './pauseRules';
import type { Employee, Minutes, PauseBlock, Settings, ShiftEntry } from './types';
import { fmtMin } from './time';

export interface PlannedBlock {
  shiftId: string;
  blockNo: number;
  start: Minutes;
  duration: number;
  isFixed: boolean;
  /** vorhandener Block, der aktualisiert wird */
  existingId?: string;
}

export interface ScheduleResult {
  blocks: PlannedBlock[];
  /** offene Blöcke, die nicht mehr benötigt werden */
  cancelIds: string[];
  /** Soll-Gesamtpause je Schicht */
  plannedPauseByShift: Record<string, number>;
  warnings: string[];
}

export interface ScheduleInput {
  shifts: ShiftEntry[];
  pauses: PauseBlock[];
  employees: Record<string, Employee>;
  settings: Settings;
  now?: Date;
}

interface Slot {
  blockNo: number;
  duration: number;
  locked: boolean;
  isFixed: boolean;
  start?: Minutes;
  existingId?: string;
}

const DAY = 24 * 60;

class Occupancy {
  private occ = new Int16Array(DAY + 240);
  add(from: number, to: number, d = 1) {
    for (let m = Math.max(0, Math.floor(from)); m < Math.min(this.occ.length, Math.ceil(to)); m++) this.occ[m] += d;
  }
  max(from: number, to: number): number {
    let mx = 0;
    for (let m = Math.max(0, Math.floor(from)); m < Math.min(this.occ.length, Math.ceil(to)); m++) if (this.occ[m] > mx) mx = this.occ[m];
    return mx;
  }
}

interface Level {
  step: number;
  spacing: boolean;
  capacity: boolean;
}
const LEVELS: Level[] = [
  { step: 15, spacing: true, capacity: true },
  { step: 5, spacing: true, capacity: true },
  { step: 5, spacing: false, capacity: true },
  { step: 5, spacing: false, capacity: false },
];

/**
 * Pausen automatisch planen:
 * 1. Laufende/erledigte Blöcke bleiben unverändert und belegen Kapazität.
 * 2. Feste Pausen-Uhrzeiten werden gesetzt, "Keine Pause" wird übersprungen.
 * 3. Flexible Blöcke werden – engste Schichten zuerst – möglichst gleichmäßig über die
 *    Schicht verteilt (Ideal: n Blöcke bei 1/(n+1), 2/(n+1) … der Schicht), unter Einhaltung von
 *    Mindestabständen und Kapazitätsgrenze. Ist das unmöglich, wird stufenweise gelockert
 *    (feineres Raster → Abstände → Kapazität) und eine Warnung ausgegeben.
 */
export function schedulePauses(input: ScheduleInput): ScheduleResult {
  const { shifts, pauses, employees, settings: cfg } = input;
  const occ = new Occupancy();
  const result: ScheduleResult = { blocks: [], cancelIds: [], plannedPauseByShift: {}, warnings: [] };

  const byShift = new Map<string, PauseBlock[]>();
  for (const p of pauses) {
    if (p.deleted_at) continue;
    (byShift.get(p.shift_entry_id) ?? byShift.set(p.shift_entry_id, []).get(p.shift_entry_id)!).push(p);
  }

  interface Job { shift: ShiftEntry; win: { start: Minutes; end: Minutes }; slots: Slot[] }
  const jobs: Job[] = [];

  for (const shift of shifts) {
    if (shift.deleted_at) continue;
    const existing = byShift.get(shift.id) ?? [];
    const win = shiftWindow(shift);
    if (!win) {
      // krank/nicht erschienen: offene Blöcke werden storniert
      for (const b of existing) if (b.status === 'open') result.cancelIds.push(b.id);
      result.plannedPauseByShift[shift.id] = 0;
      continue;
    }
    const emp = shift.employee_id ? employees[shift.employee_id] : undefined;
    const req: BlockRequirement[] = requiredBlocks(emp, win.end - win.start, cfg);
    result.plannedPauseByShift[shift.id] = req.reduce((a, r) => a + r.duration, 0);

    const slots: Slot[] = req.map((r) => {
      const ex = existing.find((b) => b.block_no === r.blockNo);
      if (ex && (ex.status === 'running' || ex.status === 'done')) {
        const span = blockSpan(ex, input.now);
        occ.add(span.from, span.to);
        return { blockNo: r.blockNo, duration: span.to - span.from, locked: true, isFixed: ex.is_fixed, start: ex.start_min, existingId: ex.id };
      }
      if (r.fixedStart !== undefined) {
        occ.add(r.fixedStart, r.fixedStart + r.duration);
        return { blockNo: r.blockNo, duration: r.duration, locked: true, isFixed: true, start: r.fixedStart, existingId: ex?.id };
      }
      return { blockNo: r.blockNo, duration: r.duration, locked: false, isFixed: false, existingId: ex?.id };
    });

    // überzählige offene Blöcke stornieren
    for (const b of existing) {
      if (b.status === 'open' || b.status === 'cancelled') {
        if (!req.some((r) => r.blockNo === b.block_no) && b.status === 'open') result.cancelIds.push(b.id);
      } else if (!req.some((r) => r.blockNo === b.block_no)) {
        // laufende/erledigte Zusatzblöcke bleiben, belegen aber Kapazität
        const span = blockSpan(b, input.now);
        occ.add(span.from, span.to);
      }
    }
    jobs.push({ shift, win, slots });
  }

  // engste Schichten zuerst, bei Gleichstand früherer Beginn
  const flexJobs = jobs
    .filter((j) => j.slots.some((s) => !s.locked))
    .sort((a, b) => a.win.end - a.win.start - (b.win.end - b.win.start) || a.win.start - b.win.start);

  for (const job of flexJobs) {
    let placed: Minutes[] | null = null;
    let usedLevel = 0;
    for (let li = 0; li < LEVELS.length && !placed; li++) {
      placed = placeShift(job.slots, job.win, occ, cfg, LEVELS[li]);
      usedLevel = li;
    }
    if (!placed) {
      // sollte durch Stufe 3 nie passieren – Fallback: gleichmäßig verteilen
      placed = job.slots.map((s, i) => s.start ?? idealStart(job.win, i, job.slots.length, s.duration));
      usedLevel = 3;
    }
    job.slots.forEach((s, i) => {
      if (!s.locked) {
        s.start = placed![i];
        occ.add(s.start, s.start + s.duration);
      }
    });
    if (usedLevel === 2) result.warnings.push(`${job.shift.employee_name}: Mindestabstände konnten nicht eingehalten werden.`);
    if (usedLevel === 3) result.warnings.push(`${job.shift.employee_name}: Kapazitätsgrenze (${cfg.max_concurrent_pauses}) musste überschritten werden.`);
  }

  for (const job of jobs) {
    for (const s of job.slots) {
      if (s.start === undefined) continue;
      result.blocks.push({ shiftId: job.shift.id, blockNo: s.blockNo, start: s.start, duration: s.duration, isFixed: s.isFixed, existingId: s.existingId });
    }
    for (const s of job.slots) {
      if (s.isFixed && s.start !== undefined && (s.start < job.win.start || s.start + s.duration > job.win.end)) {
        result.warnings.push(`${job.shift.employee_name}: Feste Pause ${fmtMin(s.start)} liegt außerhalb der Schicht.`);
      }
    }
  }
  return result;
}

function idealStart(win: { start: number; end: number }, i: number, n: number, dur: number): number {
  return Math.round(win.start + ((win.end - win.start) * (i + 1)) / (n + 1) - dur / 2);
}

function placeShift(slots: Slot[], win: { start: number; end: number }, occ: Occupancy, cfg: Settings, lv: Level): Minutes[] | null {
  const n = slots.length;
  const chosen: Minutes[] = slots.map((s) => s.start ?? NaN);
  const after = lv.spacing ? cfg.min_after_start_min : 0;
  const between = lv.spacing ? cfg.min_between_blocks_min : 0;
  const before = lv.spacing ? cfg.min_before_end_min : 0;
  let budget = 50000;

  const dfs = (i: number): boolean => {
    if (--budget < 0) return false;
    if (i === n) return true;
    const s = slots[i];
    if (s.locked) return dfs(i + 1);

    const prevEnd = i > 0 ? chosen[i - 1] + slots[i - 1].duration : null;
    let lo = prevEnd === null ? win.start + after : Math.max(win.start + after, prevEnd + between);
    // Platz für die restlichen Blöcke lassen
    let tail = 0;
    for (let k = i + 1; k < n; k++) tail += slots[k].duration + between;
    let hi = win.end - before - s.duration - tail;
    const next = slots[i + 1];
    if (next?.locked && next.start !== undefined) hi = Math.min(hi, next.start - between - s.duration);
    if (!lv.spacing) {
      lo = Math.max(win.start, prevEnd ?? win.start);
      hi = Math.min(win.end - s.duration, next?.locked && next.start !== undefined ? next.start - s.duration : Infinity);
    }
    if (hi < lo) return false;

    const ideal = idealStart(win, i, n, s.duration);
    const cands: { t: number; score: number }[] = [];
    const first = Math.ceil(lo / lv.step) * lv.step;
    for (let t = first; t <= hi; t += lv.step) {
      const load = occ.max(t, t + s.duration);
      if (lv.capacity && load + 1 > cfg.max_concurrent_pauses) continue;
      cands.push({ t, score: Math.abs(t - ideal) + load * 20 });
    }
    cands.sort((a, b) => a.score - b.score);
    for (const c of cands) {
      chosen[i] = c.t;
      occ.add(c.t, c.t + s.duration); // eigene Blöcke zählen mit
      const ok = dfs(i + 1);
      occ.add(c.t, c.t + s.duration, -1);
      if (ok) return true;
    }
    return false;
  };

  return dfs(0) ? chosen : null;
}

/** Hilfsfunktion zur Darstellung: gleichzeitige Pausen im Minutentakt. */
export function concurrencyAt(pauses: PauseBlock[], minute: number, now?: Date): number {
  return pauses.filter((p) => {
    if (!isActiveBlock(p)) return false;
    const s = blockSpan(p, now);
    return minute >= s.from && minute < s.to;
  }).length;
}
