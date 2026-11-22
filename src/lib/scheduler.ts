import { blockSpan, capacityArray, isActiveBlock, MAX_STRETCH_MIN, MIN_REST_BLOCK_MIN, pauseGrid, requiredBlocks, shiftWindow, type BlockRequirement } from './pauseRules';
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
  occ = new Int16Array(DAY + 240);
  constructor(private cap: Int16Array) {}
  add(from: number, to: number, d = 1) {
    for (let m = Math.max(0, Math.floor(from)); m < Math.min(this.occ.length, Math.ceil(to)); m++) this.occ[m] += d;
  }
  max(from: number, to: number): number {
    let mx = 0;
    for (let m = Math.max(0, Math.floor(from)); m < Math.min(this.occ.length, Math.ceil(to)); m++) if (this.occ[m] > mx) mx = this.occ[m];
    return mx;
  }
  /** passt ein weiterer Block in [from,to) unter die (zeitabhängige) Kapazitätsgrenze? */
  fits(from: number, to: number, k = 1): boolean {
    for (let m = Math.max(0, Math.floor(from)); m < Math.min(this.occ.length, Math.ceil(to)); m++) if (this.occ[m] + k > this.cap[m]) return false;
    return true;
  }
  /** Auslastung relativ zur Grenze (0 = leer, 1 = voll) */
  pressure(from: number, to: number, k = 1): number {
    let mx = 0;
    for (let m = Math.max(0, Math.floor(from)); m < Math.min(this.occ.length, Math.ceil(to)); m++) mx = Math.max(mx, (this.occ[m] + k) / Math.max(1, this.cap[m]));
    return mx;
  }
}

interface Level {
  step: number;
  spacing: boolean;
  capacity: boolean;
}
const levelsFor = (grid: number): Level[] => [
  { step: grid, spacing: true, capacity: true },
  { step: grid, spacing: false, capacity: true },
  { step: grid, spacing: false, capacity: false },
];

/**
 * Pausen automatisch planen:
 * 1. Laufende/erledigte Blöcke bleiben unverändert und belegen Kapazität.
 * 2. Feste Pausen-Uhrzeiten werden gesetzt, "Keine Pause" wird übersprungen.
 * 3. Flexible Blöcke werden – engste Schichten zuerst – möglichst gleichmäßig über die
 *    Schicht verteilt (Ideal: n Blöcke bei 1/(n+1), 2/(n+1) … der Schicht), unter Einhaltung von
 *    Mindestabständen und Kapazitätsgrenze. Ist das unmöglich, wird stufenweise gelockert
 *    (Abstände → Kapazität) und eine Warnung ausgegeben.
 * Pausen beginnen nur im eingestellten Raster (z. B. :00/:30), die Kapazität kann
 * zeitabhängig sein (z. B. max. 3, ab 14:30 max. 2). Zuerst wird eine gemeinsame Lösung
 * für alle Mitarbeiter gesucht (Backtracking), erst wenn keine existiert, wird gelockert.
 */
export function schedulePauses(input: ScheduleInput): ScheduleResult {
  const { shifts, pauses, employees, settings: cfg } = input;
  const occ = new Occupancy(capacityArray(cfg, DAY + 240));
  const grid = pauseGrid(cfg);
  const LEVELS = levelsFor(grid);
  const result: ScheduleResult = { blocks: [], cancelIds: [], plannedPauseByShift: {}, warnings: [] };

  const byShift = new Map<string, PauseBlock[]>();
  for (const p of pauses) {
    if (p.deleted_at) continue;
    (byShift.get(p.shift_entry_id) ?? byShift.set(p.shift_entry_id, []).get(p.shift_entry_id)!).push(p);
  }

  interface Job { shift: ShiftEntry; win: { start: Minutes; end: Minutes }; slots: Slot[]; group?: string; weight: number; members: Job[] }
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
    // Betriebsregel: feste erste Pause je Schichtbeginn (z. B. Schicht ab 10:00 → 12:00)
    const startRule = cfg.start_rules?.find((r) => r.start === win.start);
    if (startRule && slots[0] && !slots[0].locked && (emp?.pause_model ?? 'standard') !== 'fixed') {
      slots[0] = { ...slots[0], locked: true, isFixed: true, start: startRule.first };
      occ.add(startRule.first, startRule.first + slots[0].duration);
    }

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
    const job: Job = { shift, win, slots, group: emp?.pause_group?.trim() || undefined, weight: 1, members: [] };
    job.members.push(job);
    jobs.push(job);
  }

  // engste Schichten zuerst (effektives Zeitfenster inkl. "letzte Pause um"), bei Gleichstand früherer Beginn
  const effWindow = (j: Job) => {
    const lastStart = Math.min(j.win.end - cfg.min_before_end_min, cfg.latest_pause_start != null ? cfg.latest_pause_start + 30 : Infinity);
    return lastStart - (j.win.start + cfg.min_after_start_min);
  };
  // Pausenpartner (gleiche Gruppe, gleiche Schicht, gleiche Blöcke) werden gemeinsam geplant
  const sig = (j: Job) => `${j.group}|${j.win.start}|${j.win.end}|${j.slots.map((s) => (s.locked ? `L${s.start}` : '') + s.duration).join(',')}`;
  const grouped = new Map<string, Job>();
  const planJobs: Job[] = [];
  for (const j of jobs) {
    if (!j.group || !j.slots.some((s) => !s.locked)) { planJobs.push(j); continue; }
    const lead = grouped.get(sig(j));
    if (lead) { lead.members.push(j); lead.weight++; } else { grouped.set(sig(j), j); planJobs.push(j); }
  }
  const flexJobs = planJobs
    .filter((j) => j.slots.some((s) => !s.locked))
    .sort((a, b) => effWindow(a) - effWindow(b) || a.win.start - b.win.start);

  // 1) Gemeinsame Lösung für alle (strenge Regeln)
  const cands = flexJobs.map((job) => enumerateShift(job.slots, job.win, cfg, LEVELS[0], 80));
  const chosen: (Minutes[] | null)[] = flexJobs.map(() => null);
  let budget = 250000;
  const fitsAll = (job: Job, times: Minutes[]) => job.slots.every((sl, i) => sl.locked || occ.fits(times[i], times[i] + sl.duration, job.weight));
  const apply = (job: Job, times: Minutes[], d: number) => job.slots.forEach((sl, i) => !sl.locked && occ.add(times[i], times[i] + sl.duration, d * job.weight));
  const searchAll = (k: number): boolean => {
    if (k === flexJobs.length) return true;
    const job = flexJobs[k];
    const ranked = cands[k]
      .map((c) => ({ c, s: c.score + job.slots.reduce((a, sl, i) => a + (sl.locked ? 0 : occ.pressure(c.times[i], c.times[i] + sl.duration, job.weight) * 25), 0) }))
      .sort((a, b) => a.s - b.s);
    for (const { c } of ranked) {
      if (--budget < 0) return false;
      if (!fitsAll(job, c.times)) continue;
      apply(job, c.times, 1);
      chosen[k] = c.times;
      if (searchAll(k + 1)) return true;
      apply(job, c.times, -1);
      chosen[k] = null;
    }
    return false;
  };
  const globalOk = cands.every((c) => c.length > 0) && searchAll(0);

  if (globalOk) {
    flexJobs.forEach((job, k) => job.members.forEach((m) => m.slots.forEach((sl, i) => { if (!sl.locked) sl.start = chosen[k]![i]; })));
  } else {
    // 2) Fallback: nacheinander planen und bei Bedarf Regeln lockern (mit Warnung)
    for (const job of flexJobs) {
      let placed: Minutes[] | null = null;
      let usedLevel = 0;
      for (let li = 0; li < LEVELS.length && !placed; li++) {
        placed = placeShift(job.slots, job.win, occ, cfg, LEVELS[li], job.weight);
        usedLevel = li;
      }
      if (!placed) {
        placed = job.slots.map((s, i) => s.start ?? idealStart(job.win, i, job.slots.length, s.duration));
        usedLevel = 2;
      }
      job.slots.forEach((s, i) => {
        if (!s.locked) occ.add(placed![i], placed![i] + s.duration, job.weight);
      });
      job.members.forEach((m) => m.slots.forEach((s, i) => { if (!s.locked) s.start = placed![i]; }));
      if (usedLevel === 1) result.warnings.push(`${job.shift.employee_name}: Mindestabstände konnten nicht eingehalten werden.`);
      if (usedLevel === 2) result.warnings.push(`${job.shift.employee_name}: Pausen-Kapazität musste überschritten werden.`);
    }
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

/** Erlaubter Bereich [lo, hi] und Idealzeit für den i-ten Block einer Schicht. */
function slotBounds(slots: Slot[], win: { start: number; end: number }, cfg: Settings, lv: Level, i: number, chosen: Minutes[]) {
  const n = slots.length;
  const s = slots[i];
  const after = lv.spacing ? cfg.min_after_start_min : 0;
  const between = lv.spacing ? cfg.min_between_blocks_min : 0;
  const before = lv.spacing ? cfg.min_before_end_min : 0;
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
  // § 4 ArbZG: nie mehr als 6 Std. am Stück ohne Ruhepause (gilt auf allen Stufen)
  if (win.end - win.start > MAX_STRETCH_MIN && s.duration >= MIN_REST_BLOCK_MIN) {
    hi = Math.min(hi, (prevEnd ?? win.start) + MAX_STRETCH_MIN);
    if (i === n - 1) lo = Math.max(lo, win.end - MAX_STRETCH_MIN - s.duration);
  }
  // Betriebsregel: letzte Pause startet spätestens um … (z. B. 15:30)
  if (cfg.latest_pause_start != null && lv.capacity) hi = Math.min(hi, cfg.latest_pause_start);
  return { lo, hi, ideal: idealStart(win, i, n, s.duration) };
}

/** Bewertung einer Startzeit: nah am Ideal, die letzte erlaubte Pausenzeit möglichst meiden. */
const timeScore = (t: number, ideal: number, cfg: Settings) => Math.abs(t - ideal) + (cfg.latest_pause_start != null && t >= cfg.latest_pause_start ? 150 : 0);

/** Alle regelkonformen Startzeit-Kombinationen einer Schicht (ohne Rücksicht auf andere), beste zuerst. */
function enumerateShift(slots: Slot[], win: { start: number; end: number }, cfg: Settings, lv: Level, limit: number): { times: Minutes[]; score: number }[] {
  const n = slots.length;
  const chosen: Minutes[] = slots.map((s) => s.start ?? NaN);
  const out: { times: Minutes[]; score: number }[] = [];
  let budget = 20000;
  const rec = (i: number, score: number) => {
    if (--budget < 0) return;
    if (i === n) { out.push({ times: [...chosen], score }); return; }
    if (slots[i].locked) return rec(i + 1, score);
    const { lo, hi, ideal } = slotBounds(slots, win, cfg, lv, i, chosen);
    for (let t = Math.ceil(lo / lv.step) * lv.step; t <= hi; t += lv.step) {
      chosen[i] = t;
      rec(i + 1, score + timeScore(t, ideal, cfg));
    }
    chosen[i] = NaN;
  };
  rec(0, 0);
  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

function placeShift(slots: Slot[], win: { start: number; end: number }, occ: Occupancy, cfg: Settings, lv: Level, weight = 1): Minutes[] | null {
  const n = slots.length;
  const chosen: Minutes[] = slots.map((s) => s.start ?? NaN);
  let budget = 50000;

  const dfs = (i: number): boolean => {
    if (--budget < 0) return false;
    if (i === n) return true;
    const s = slots[i];
    if (s.locked) return dfs(i + 1);
    const { lo, hi, ideal } = slotBounds(slots, win, cfg, lv, i, chosen);
    if (hi < lo) return false;
    const cands: { t: number; score: number }[] = [];
    for (let t = Math.ceil(lo / lv.step) * lv.step; t <= hi; t += lv.step) {
      if (lv.capacity && !occ.fits(t, t + s.duration, weight)) continue;
      cands.push({ t, score: timeScore(t, ideal, cfg) + occ.max(t, t + s.duration) * 20 });
    }
    cands.sort((a, b) => a.score - b.score);
    for (const c of cands) {
      chosen[i] = c.t;
      occ.add(c.t, c.t + s.duration, weight); // eigene Blöcke zählen mit
      const ok = dfs(i + 1);
      occ.add(c.t, c.t + s.duration, -weight);
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
