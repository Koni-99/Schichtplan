import type { PauseBlock, ShiftStatus } from '../../lib/types';

export const PAUSE_STATUS_LABEL: Record<PauseBlock['status'], string> = {
  open: 'Offen',
  running: 'Läuft gerade',
  done: 'Erledigt',
  cancelled: 'Gestrichen',
};

export function pauseClasses(p: PauseBlock): string {
  switch (p.status) {
    case 'running':
      return 'bg-amber-400 text-stone-900 border-amber-600 pulse-ring';
    case 'done':
      return 'bg-emerald-500 text-white border-emerald-700';
    case 'cancelled':
      return 'bg-stone-200 text-stone-500 border-stone-300 stripes line-through';
    default:
      return p.is_fixed ? 'bg-violet-500 text-white border-violet-700' : 'bg-sky-500 text-white border-sky-700';
  }
}

export const STATUS_TONE: Record<ShiftStatus, 'green' | 'red' | 'amber' | 'blue' | 'stone'> = {
  present: 'green',
  sick: 'red',
  absent: 'red',
  removed: 'stone',
  left_early: 'amber',
  came_late: 'blue',
};
