import type { DailyPlan, PauseBlock, Settings, ShiftEntry } from './types';
import { isNotWorking, SHIFT_STATUS_LABEL } from './types';
import { fmtMin } from './time';

export type DeviationKind = 'time' | 'sick' | 'absent' | 'removed' | 'pause' | 'manual' | 'note';

export interface ShiftDiff {
  shift: ShiftEntry;
  sollStart: number | null;
  sollEnd: number | null;
  istStart: number | null;
  istEnd: number | null;
  sollPause: number;
  istPause: number;
  sollWork: number;
  istWork: number;
  kinds: DeviationKind[];
  summary: string[];
  blocks: PauseBlock[];
}

export const DEVIATION_LABEL: Record<DeviationKind, string> = {
  time: 'Arbeitszeit',
  sick: 'Krank',
  absent: 'Nicht erschienen',
  removed: 'Aus Plan entfernt',
  pause: 'Pausenzeit',
  manual: 'Manuell ergänzt',
  note: 'Notiz',
};

/** Ist-Pause einer Schicht: eingefrorener Wert (nach Abschluss) oder Live-Berechnung. */
export function computeActualPause(shift: ShiftEntry, blocks: PauseBlock[], cfg: Settings, now = new Date()): number {
  if (shift.actual_pause_min != null) return shift.actual_pause_min;
  return blocks
    .filter((b) => !b.deleted_at && b.shift_entry_id === shift.id)
    .reduce((sum, b) => {
      if (b.status === 'done') return sum + (b.actual_duration_min ?? b.planned_duration_min);
      if (b.status === 'running' && b.actual_start_at) return sum + Math.round((now.getTime() - new Date(b.actual_start_at).getTime()) / 60000);
      if (b.status === 'open' && cfg.count_unstarted_as_taken && !isNotWorking(shift.status)) return sum + b.planned_duration_min;
      return sum;
    }, 0);
}

export function diffShift(shift: ShiftEntry, blocks: PauseBlock[], cfg: Settings): ShiftDiff {
  const own = blocks.filter((b) => !b.deleted_at && b.shift_entry_id === shift.id).sort((a, b) => a.block_no - b.block_no);
  const notWorking = isNotWorking(shift.status);
  const sollStart = shift.planned_start_min, sollEnd = shift.planned_end_min;
  const istStart = notWorking ? null : shift.actual_start_min ?? sollStart;
  const istEnd = notWorking ? null : shift.actual_end_min ?? sollEnd;
  const sollPause = shift.planned_pause_min;
  const istPause = notWorking ? 0 : computeActualPause(shift, own, cfg);
  const sollWork = sollStart != null && sollEnd != null ? sollEnd - sollStart - sollPause : 0;
  const istWork = istStart != null && istEnd != null ? istEnd - istStart - istPause : 0;

  const kinds: DeviationKind[] = [];
  const summary: string[] = [];
  if (shift.status === 'sick') { kinds.push('sick'); summary.push('Krankmeldung'); }
  if (shift.status === 'absent') { kinds.push('absent'); summary.push('Nicht erschienen'); }
  if (shift.status === 'removed') {
    kinds.push('removed');
    const when = shift.removed_at ? new Date(shift.removed_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : null;
    summary.push(`Aus Plan entfernt${shift.removed_reason ? `: ${shift.removed_reason}` : ''}${shift.removed_by_name || when ? ` (${[shift.removed_by_name, when && `${when} Uhr`].filter(Boolean).join(', ')})` : ''}`);
  }
  if (shift.is_manual) { kinds.push('manual'); summary.push('Manuell ergänzt (Springer/Aushilfe)'); }
  if (!notWorking && !shift.is_manual && (istStart !== sollStart || istEnd !== sollEnd)) {
    kinds.push('time');
    summary.push(`Soll: ${fmtMin(sollStart)}–${fmtMin(sollEnd)} → Ist: ${fmtMin(istStart)}–${fmtMin(istEnd)}${shift.status !== 'present' ? ` (${SHIFT_STATUS_LABEL[shift.status]})` : ''}`);
  }
  if (!notWorking && istPause !== sollPause) {
    kinds.push('pause');
    summary.push(`Pause Soll: ${sollPause} Min. → Ist: ${istPause} Min.`);
  }
  if (shift.note.trim()) { kinds.push('note'); summary.push(`Notiz: ${shift.note.trim()}`); }

  return { shift, sollStart, sollEnd, istStart, istEnd, sollPause, istPause, sollWork, istWork, kinds, summary, blocks: own };
}

export function diffPlan(_plan: DailyPlan, shifts: ShiftEntry[], blocks: PauseBlock[], cfg: Settings): ShiftDiff[] {
  return shifts
    .filter((s) => !s.deleted_at)
    .sort((a, b) => (a.planned_start_min ?? a.actual_start_min ?? 9999) - (b.planned_start_min ?? b.actual_start_min ?? 9999) || a.sort_order - b.sort_order)
    .map((s) => diffShift(s, blocks, cfg));
}

export function planHasDeviations(diffs: ShiftDiff[]): boolean {
  return diffs.some((d) => d.kinds.length > 0);
}
