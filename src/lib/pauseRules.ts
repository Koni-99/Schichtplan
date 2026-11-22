import type { Employee, Minutes, PauseBlock, Settings, ShiftEntry } from './types';

export interface BlockRequirement {
  blockNo: number;
  duration: number;
  /** gesetzt bei festem Pausenprofil */
  fixedStart?: Minutes;
}

/** Effektives Arbeitszeitfenster einer Schicht (Ist vor Soll). null = keine Arbeit (krank/nicht erschienen). */
export function shiftWindow(s: ShiftEntry): { start: Minutes; end: Minutes } | null {
  if (s.status === 'sick' || s.status === 'absent') return null;
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
