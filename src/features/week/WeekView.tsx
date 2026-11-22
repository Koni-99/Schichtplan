import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, FileUp, Lock, UserPlus } from 'lucide-react';
import { useDB } from '../../store/db';
import type { DailyPlan, ShiftEntry } from '../../lib/types';
import { SHIFT_STATUS_LABEL } from '../../lib/types';
import { fmtMin, isoWeek, parseISODate, toISODate, todayISO } from '../../lib/time';
import { shiftWindow } from '../../lib/pauseRules';
import { Badge, Button } from '../../components/ui';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function mondayOf(iso: string): Date {
  const d = parseISODate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Wochenübersicht: Mitarbeiter × Wochentage, Tag antippen öffnet den Tagesplan. */
export function WeekView({ onOpenDay, onGoImport }: { onOpenDay: (planId: string) => void; onGoImport?: () => void }) {
  const plans = useDB((s) => s.plans);
  const shiftsAll = useDB((s) => s.shifts);
  const pausesAll = useDB((s) => s.pauses);
  const today = todayISO();
  const [monday, setMonday] = useState(() => mondayOf(today));

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => toISODate(addDays(monday, i))), [monday]);
  const planByDate = useMemo(() => {
    const m = new Map<string, DailyPlan>();
    Object.values(plans).forEach((p) => !p.deleted_at && m.set(p.plan_date, p));
    return m;
  }, [plans]);
  const weekPlans = days.map((d) => planByDate.get(d));

  // Zeilen: alle Mitarbeiter, die in dieser Woche mindestens einmal eingeplant sind
  const { rows, cell, counts } = useMemo(() => {
    const ids = new Set(weekPlans.filter(Boolean).map((p) => p!.id));
    const cell = new Map<string, ShiftEntry>(); // key: rowKey|date
    const rowsMap = new Map<string, { key: string; name: string; first: number }>();
    const counts = new Map<string, number>();
    for (const s of Object.values(shiftsAll)) {
      if (s.deleted_at || !ids.has(s.plan_id)) continue;
      const date = plans[s.plan_id].plan_date;
      const key = s.employee_id ?? `name:${s.employee_name.toLowerCase()}`;
      const start = s.actual_start_min ?? s.planned_start_min ?? 9999;
      const row = rowsMap.get(key);
      if (!row) rowsMap.set(key, { key, name: s.employee_name, first: start });
      else row.first = Math.min(row.first, start);
      cell.set(`${key}|${date}`, s);
      if (shiftWindow(s)) counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    const rows = [...rowsMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return { rows, cell, counts };
  }, [weekPlans, shiftsAll, plans]); // eslint-disable-line react-hooks/exhaustive-deps

  const pauseCount = (shiftId: string) => Object.values(pausesAll).filter((p) => p.shift_entry_id === shiftId && !p.deleted_at && p.status !== 'cancelled').length;
  const kw = isoWeek(days[0]);
  const isCurrent = days.includes(today);
  const any = weekPlans.some(Boolean);
  const fmtShort = (iso: string) => parseISODate(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">
          KW {kw.week} <span className="text-lg font-semibold text-stone-500">· {fmtShort(days[0])} – {fmtShort(days[6])}{parseISODate(days[6]).getFullYear()}</span>
        </h1>
        <button aria-label="Vorherige Woche" onClick={() => setMonday(addDays(monday, -7))} className="flex h-12 w-12 items-center justify-center rounded-xl bg-white ring-1 ring-stone-300">
          <ChevronLeft />
        </button>
        {!isCurrent && <Button onClick={() => setMonday(mondayOf(today))}>Diese Woche</Button>}
        <button aria-label="Nächste Woche" onClick={() => setMonday(addDays(monday, 7))} className="flex h-12 w-12 items-center justify-center rounded-xl bg-white ring-1 ring-stone-300">
          <ChevronRight />
        </button>
      </div>

      {!any ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-10 text-center ring-1 ring-stone-200">
          <CalendarDays size={48} className="text-stone-300" />
          <p className="text-lg font-semibold">Für KW {kw.week} gibt es noch keine Pläne.</p>
          {onGoImport && <Button variant="primary" icon={<FileUp size={18} />} onClick={onGoImport}>Wochenplan hochladen</Button>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-stone-200">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-44 border-b border-stone-200 bg-stone-50 px-3 py-2 text-left text-stone-600">Mitarbeiter</th>
                {days.map((d, i) => {
                  const p = weekPlans[i];
                  const isToday = d === today;
                  return (
                    <th key={d} className={`border-b border-l border-stone-200 p-0 ${isToday ? 'bg-brand-50' : 'bg-stone-50'}`}>
                      <button
                        disabled={!p}
                        onClick={() => p && onOpenDay(p.id)}
                        className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-2 py-1 enabled:hover:bg-brand-100"
                        title={p ? 'Tagesplan öffnen' : 'Kein Plan'}
                      >
                        <span className={`font-bold ${isToday ? 'text-brand-700' : ''}`}>{WD[i]} {fmtShort(d)}</span>
                        {!p ? (
                          <span className="text-xs font-normal text-stone-400">kein Plan</span>
                        ) : p.status === 'closed' ? (
                          <Badge tone="stone"><Lock size={10} /> abgeschlossen</Badge>
                        ) : (
                          <Badge tone={isToday ? 'brand' : 'green'}>{isToday ? 'heute' : 'offen'} · {counts.get(d) ?? 0} MA</Badge>
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-stone-50/60">
                  <td className="sticky left-0 z-10 truncate border-b border-stone-100 bg-white px-3 py-2 font-semibold">{r.name}</td>
                  {days.map((d, i) => {
                    const s = cell.get(`${r.key}|${d}`);
                    const p = weekPlans[i];
                    const win = s ? shiftWindow(s) : null;
                    const changed = s && win && s.planned_start_min != null && (win.start !== s.planned_start_min || win.end !== s.planned_end_min);
                    return (
                      <td key={d} className={`border-b border-l border-stone-100 p-0 text-center ${d === today ? 'bg-brand-50/50' : ''}`}>
                        {s ? (
                          <button onClick={() => p && onOpenDay(p.id)} className="flex min-h-12 w-full flex-col items-center justify-center px-1 py-1">
                            {win ? (
                              <>
                                <span className={`tabular-nums font-semibold ${changed ? 'text-orange-700' : ''}`}>
                                  {s.is_manual && <UserPlus size={12} className="mr-0.5 inline text-violet-600" />}
                                  {fmtMin(win.start)}–{fmtMin(win.end)}
                                </span>
                                <span className="text-[11px] text-stone-500">
                                  {s.status !== 'present' ? SHIFT_STATUS_LABEL[s.status] : `${pauseCount(s.id)} Pause${pauseCount(s.id) === 1 ? '' : 'n'}`}
                                </span>
                              </>
                            ) : (
                              <Badge tone={s.status === 'removed' ? 'stone' : 'red'}>{SHIFT_STATUS_LABEL[s.status]}</Badge>
                            )}
                          </button>
                        ) : (
                          <span className="text-stone-300">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-stone-500">Tag oder Schicht antippen, um den Tagesplan zu öffnen. Orange = abweichend vom PEPZeit-Plan.</p>
    </div>
  );
}
