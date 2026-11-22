import type { Employee, Minutes, PauseBlock, Settings, ShiftEntry } from './types';
import { isNotWorking } from './types';

export interface BlockRequirement {
  blockNo: number;
  duration: number;
  /** gesetzt bei festem Pausenprofil */
  fixedStart?: Minutes;
}

/** Effektives Arbeitszeitfenster einer Schicht (Ist vor Soll). null = keine Arbeit (krank/nicht erschienen). */
export function shiftWindow(s: ShiftEntry): { start: Minutes; end: Minutes } | null {
  if (isNotWorking(s.status)) return null;
  const start = s.actual_start_min ?? s.planned_start_min;
  const end = s.actual_end_min ?? s.planned_end_min;
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** Welche Pausenblöcke stehen einem Mitarbeiter laut Profil + Einstellungen zu? */
export function requiredBlocks(emp: Employee | undefined, shiftLength: number, s: Settings): BlockRequirement[] {
  const model = emp?.pause_model ?? 'standard';
  const mk = (count: number, minutes: number): BlockRequirement[] =>
    Array.from({ length: Math.max(0, count) }, (_, i) => ({ blockNo: i + 1, duration: minutes }));

  switch (model) {
    case 'none':
      return [];
    case 'fixed':
      return [...(emp?.fixed_starts ?? [])]
        .sort((a, b) => a - b)
        .map((start, i) => ({ blockNo: i + 1, duration: emp?.fixed_block_minutes ?? 30, fixedStart: start }));
    case 'flexible_custom':
      if (shiftLength < s.short_shift_threshold_min) return mk(s.short_shift_block_count, s.short_shift_block_minutes);
      return mk(emp?.custom_block_count ?? 2, emp?.custom_block_minutes ?? 15);
    case 'standard':
    default:
      if (shiftLength < s.short_shift_threshold_min) return mk(s.short_shift_block_count, s.short_shift_block_minutes);
      return mk(s.default_block_count, s.default_block_minutes);
  }
}

export function requiredPauseMinutes(emp: Employee | undefined, s: ShiftEntry, settings: Settings): number {
  const w = shiftWindow(s);
  if (!w) return 0;
  return requiredBlocks(emp, w.end - w.start, settings).reduce((a, b) => a + b.duration, 0);
}

/** § 4 ArbZG: länger als 6 Std. hintereinander darf nicht ohne Ruhepause gearbeitet werden. */
export const MAX_STRETCH_MIN = 360;
/** Nur Pausen ab 15 Min. zählen als Ruhepause (§ 4 Satz 2 ArbZG). */
export const MIN_REST_BLOCK_MIN = 15;

/** Längster Arbeitsabschnitt ohne Ruhepause innerhalb eines Arbeitszeitfensters. */
export function longestStretch(win: { start: Minutes; end: Minutes }, pauses: { from: Minutes; to: Minutes }[]): { from: Minutes; to: Minutes; length: number } {
  const rests = pauses
    .filter((p) => p.to - p.from >= MIN_REST_BLOCK_MIN)
    .map((p) => ({ from: Math.max(win.start, p.from), to: Math.min(win.end, p.to) }))
    .filter((p) => p.to > p.from)
    .sort((a, b) => a.from - b.from);
  let best = { from: win.start, to: win.start, length: 0 };
  let cursor = win.start;
  for (const r of [...rests, { from: win.end, to: win.end }]) {
    if (r.from - cursor > best.length) best = { from: cursor, to: r.from, length: r.from - cursor };
    cursor = Math.max(cursor, r.to);
  }
  return best;
}

/** Raster für Pausenbeginn in Minuten (z. B. 30 = nur :00 und :30). */
export const pauseGrid = (cfg: Settings) => (cfg.pause_grid_min && cfg.pause_grid_min > 0 ? cfg.pause_grid_min : 5);

/** Erlaubte gleichzeitige Pausen zu einer Uhrzeit (z. B. max. 3, ab 14:30 max. 2). */
export function capacityAt(cfg: Settings, minute: Minutes): number {
  let cap = cfg.max_concurrent_pauses;
  let from = -1;
  for (const r of cfg.capacity_rules ?? []) if (r.from <= minute && r.from > from) { from = r.from; cap = r.max; }
  return cap;
}
export function capacityArray(cfg: Settings, length: number): Int16Array {
  const a = new Int16Array(length);
  for (let m = 0; m < length; m++) a[m] = capacityAt(cfg, m);
  return a;
}

/** Dauer, die ein Block die Pausenkapazität belegt. */
export function blockSpan(b: PauseBlock, now?: Date): { from: Minutes; to: Minutes } {
  if (b.status === 'done' && b.actual_duration_min != null) {
    return { from: b.start_min, to: b.start_min + b.actual_duration_min };
  }
  if (b.status === 'running' && b.actual_start_at && now) {
    const elapsed = (now.getTime() - new Date(b.actual_start_at).getTime()) / 60000;
    return { from: b.start_min, to: b.start_min + Math.max(b.planned_duration_min, Math.ceil(elapsed)) };
  }
  return { from: b.start_min, to: b.start_min + b.planned_duration_min };
}

export function isActiveBlock(b: PauseBlock): boolean {
  return !b.deleted_at && b.status !== 'cancelled';
}
