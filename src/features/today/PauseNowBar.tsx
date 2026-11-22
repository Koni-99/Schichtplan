import { Coffee, Timer } from 'lucide-react';
import type { PauseBlock, ShiftEntry } from '../../lib/types';
import { fmtCountdown, fmtMin, minutesBetween, nowMinutes } from '../../lib/time';
import { endPause, startPause } from '../../store/actions';
import { shiftWindow } from '../../lib/pauseRules';

/** „Aktuell in Pause“ – ganz oben: belegte Plätze, Namen, Restzeit + nächste Pausen. */
export function PauseNowBar({ shifts, pauses, max, now, readOnly, isToday }: { shifts: ShiftEntry[]; pauses: PauseBlock[]; max: number; now: Date; readOnly: boolean; isToday: boolean }) {
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const running = pauses.filter((p) => p.status === 'running' && shiftById.has(p.shift_entry_id));
  const nowM = nowMinutes(now);
  const upcoming = isToday
    ? pauses
        .filter((p) => p.status === 'open' && p.start_min <= nowM + 30 && p.start_min >= nowM - 30 && shiftById.get(p.shift_entry_id) && shiftWindow(shiftById.get(p.shift_entry_id)!))
        .sort((a, b) => a.start_min - b.start_min)
        .slice(0, 6)
    : [];
  const over = running.length > max;

  return (
    <section className={`rounded-2xl border p-3 sm:p-4 ${over ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Coffee className={over ? 'text-red-700' : 'text-amber-700'} />
          <span className="text-lg font-bold">Aktuell in Pause</span>
        </div>
        <div className="flex items-center gap-1" aria-label={`${running.length} von ${max} Pausenplätzen belegt`}>
          {Array.from({ length: Math.max(max, running.length) }, (_, i) => (
            <span key={i} className={`h-4 w-4 rounded-full ${i < running.length ? (i >= max ? 'bg-red-600' : 'bg-amber-500') : 'bg-white ring-1 ring-amber-300'}`} />
          ))}
        </div>
        <span className={`text-lg font-bold tabular-nums ${over ? 'text-red-700' : ''}`}>
          {running.length} / {max} Plätze belegt
        </span>
      </div>

      {running.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {running.map((p) => {
            const elapsed = p.actual_start_at ? minutesBetween(p.actual_start_at, now) : 0;
            const remaining = p.planned_duration_min - elapsed;
            const overdue = remaining < 0;
            return (
              <div key={p.id} className={`flex items-center gap-3 rounded-xl bg-white p-2 pl-3 shadow-sm ${overdue ? 'ring-2 ring-red-500' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{shiftById.get(p.shift_entry_id)?.employee_name}</div>
                  <div className="text-xs text-stone-500">
                    Block {p.block_no} · seit {p.actual_start_at ? new Date(p.actual_start_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–'}
                  </div>
                </div>
                <div className={`flex items-center gap-1 text-xl font-bold tabular-nums ${overdue ? 'text-red-600' : 'text-stone-800'}`}>
                  <Timer size={18} />
                  {fmtCountdown(remaining)}
                </div>
                {!readOnly && (
                  <button onClick={() => endPause(p.id)} className="min-h-12 rounded-xl bg-emerald-600 px-3 font-semibold text-white">
                    Ende
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-sm font-semibold text-stone-600">Als Nächstes (±30 Min.)</div>
          <div className="flex flex-wrap gap-2">
            {upcoming.map((p) => (
              <button
                key={p.id}
                disabled={readOnly}
                onClick={() => startPause(p.id)}
                className={`flex min-h-12 items-center gap-2 rounded-xl border bg-white px-3 text-left ${p.start_min < nowM ? 'border-orange-400' : 'border-stone-300'}`}
                title="Pause jetzt starten"
              >
                <span className="font-semibold">{shiftById.get(p.shift_entry_id)?.employee_name}</span>
                <span className="text-sm tabular-nums text-stone-500">
                  B{p.block_no} {fmtMin(p.start_min)} · {p.planned_duration_min}′
                </span>
                {!readOnly && <span className="rounded-lg bg-amber-500 px-2 py-1 text-xs font-bold text-stone-900">Start</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {running.length === 0 && upcoming.length === 0 && <p className="mt-1 text-sm text-stone-600">Gerade ist niemand in der Pause.</p>}
    </section>
  );
}
