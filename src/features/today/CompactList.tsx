import { AlertTriangle, Minus, Play, Plus, Square, StickyNote, UserPlus } from 'lucide-react';
import type { PauseBlock, ShiftEntry } from '../../lib/types';
import { SHIFT_STATUS_LABEL } from '../../lib/types';
import type { PlanIssues } from '../../lib/validation';
import { fmtCountdown, fmtMin, minutesBetween } from '../../lib/time';
import { shiftWindow } from '../../lib/pauseRules';
import { endPause, movePause, startPause, stepTime } from '../../store/actions';
import { Badge } from '../../components/ui';
import { pauseClasses, PAUSE_STATUS_LABEL, STATUS_TONE } from './styles';

/** Kompaktliste – ideal fürs Smartphone und Hochformat. */
export function CompactList({ shifts, pausesByShift, issues, readOnly, now, onOpenShift, onOpenPause }: {
  shifts: ShiftEntry[]; pausesByShift: Map<string, PauseBlock[]>; issues: PlanIssues; readOnly: boolean; now: Date;
  onOpenShift: (id: string) => void; onOpenPause: (id: string) => void;
}) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {shifts.map((s) => {
        const win = shiftWindow(s);
        const pauses = pausesByShift.get(s.id) ?? [];
        const shiftIssues = issues.byShift[s.id] ?? [];
        return (
          <div key={s.id} className={`rounded-2xl border bg-white p-3 ${!win ? 'border-stone-200 opacity-70' : 'border-stone-200'}`}>
            <button className="flex w-full items-start gap-2 text-left" onClick={() => onOpenShift(s.id)}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-lg font-bold">
                  {s.is_manual && <UserPlus size={16} className="text-violet-600" />}
                  <span className={`truncate ${!win ? 'line-through' : ''}`}>{s.employee_name}</span>
                  {s.note && <StickyNote size={15} className="text-stone-400" />}
                </div>
                <div className="text-sm tabular-nums text-stone-500">
                  {win ? `${fmtMin(win.start)}–${fmtMin(win.end)}` : 'keine Arbeitszeit'}
                  {s.planned_start_min != null && win && (win.start !== s.planned_start_min || win.end !== s.planned_end_min) && (
                    <span className="ml-1 text-xs">(Soll {fmtMin(s.planned_start_min)}–{fmtMin(s.planned_end_min)})</span>
                  )}
                </div>
              </div>
              {s.status !== 'present' && <Badge tone={STATUS_TONE[s.status]}>{SHIFT_STATUS_LABEL[s.status]}</Badge>}
              {s.is_manual && <Badge tone="violet">Springer</Badge>}
            </button>
            {shiftIssues.map((i) => (
              <div key={i.text} className={`mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm ${i.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-orange-50 text-orange-800'}`}>
                <AlertTriangle size={14} /> {i.text}
              </div>
            ))}
            {pauses.length > 0 && (
              <div className="mt-2 space-y-2">
                {pauses.map((p) => {
                  const bi = issues.byBlock[p.id] ?? [];
                  const remaining = p.status === 'running' && p.actual_start_at ? p.planned_duration_min - minutesBetween(p.actual_start_at, now) : null;
                  return (
                    <div key={p.id} className="flex items-center gap-2">
                      <button
                        onClick={() => onOpenPause(p.id)}
                        className={`flex min-h-12 flex-1 items-center justify-between gap-2 rounded-xl border-2 px-3 text-left ${pauseClasses(p)} ${bi.some((i) => i.severity === 'error') ? '!border-red-600' : bi.length ? '!border-orange-500' : ''}`}
                      >
                        <span className="font-semibold">
                          {bi.length > 0 && <AlertTriangle size={14} className="mr-1 inline" />}B{p.block_no} · {fmtMin(p.start_min)} · {p.status === 'done' ? `${p.actual_duration_min ?? p.planned_duration_min}` : p.planned_duration_min} Min.
                        </span>
                        <span className="text-sm">{remaining !== null ? fmtCountdown(remaining) : PAUSE_STATUS_LABEL[p.status]}</span>
                      </button>
                      {!readOnly && win && p.status === 'open' && (
                        <>
                          <button aria-label="Früher" className="flex h-12 w-12 items-center justify-center rounded-xl border border-stone-300 bg-white" onClick={() => movePause(p.id, stepTime(p.start_min, -1))}>
                            <Minus size={18} />
                          </button>
                          <button aria-label="Später" className="flex h-12 w-12 items-center justify-center rounded-xl border border-stone-300 bg-white" onClick={() => movePause(p.id, stepTime(p.start_min, 1))}>
                            <Plus size={18} />
                          </button>
                          <button aria-label="Pause starten" className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500 text-stone-900" onClick={() => startPause(p.id)}>
                            <Play size={18} />
                          </button>
                        </>
                      )}
                      {!readOnly && p.status === 'running' && (
                        <button aria-label="Pause beenden" className="flex h-12 items-center gap-1 rounded-xl bg-emerald-600 px-3 font-semibold text-white" onClick={() => endPause(p.id)}>
                          <Square size={16} /> Ende
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
