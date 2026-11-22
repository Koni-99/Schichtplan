import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { AlertTriangle, StickyNote, UserPlus } from 'lucide-react';
import type { PauseBlock, ShiftEntry } from '../../lib/types';
import { SHIFT_STATUS_LABEL } from '../../lib/types';
import type { PlanIssues } from '../../lib/validation';
import { shiftWindow, blockSpan } from '../../lib/pauseRules';
import { fmtMin, nowMinutes } from '../../lib/time';
import { movePause } from '../../store/actions';
import { pauseClasses, STATUS_TONE } from './styles';
import { Badge } from '../../components/ui';

interface Props {
  shifts: ShiftEntry[];
  pausesByShift: Map<string, PauseBlock[]>;
  issues: PlanIssues;
  isToday: boolean;
  readOnly: boolean;
  now: Date;
  onOpenShift: (id: string) => void;
  onOpenPause: (id: string) => void;
}

const SNAP = 5;
/** Zeilenhöhe wächst mit der eingestellten Schriftgröße (4rem). */
const rowHeight = () => Math.round(4 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16));

export function Timeline({ shifts, pausesByShift, issues, isToday, readOnly, now, onOpenShift, onOpenPause }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);

  const [rangeStart, rangeEnd] = useMemo(() => {
    let lo = 5 * 60, hi = 20 * 60;
    for (const s of shifts) {
      const a = s.actual_start_min ?? s.planned_start_min, b = s.actual_end_min ?? s.planned_end_min;
      if (a != null) lo = Math.min(lo, Math.floor(a / 60) * 60);
      if (b != null) hi = Math.max(hi, Math.ceil(b / 60) * 60);
    }
    return [lo, hi];
  }, [shifts]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const ROW_H = rowHeight();
  const nameW = width < 640 ? 120 : Math.round(190 * (ROW_H / 64));
  const span = rangeEnd - rangeStart;
  const ppm = Math.max(1.6, (width - nameW - 8) / span); // Pixel pro Minute
  const trackW = span * ppm;
  const x = (m: number) => (m - rangeStart) * ppm;
  const nowM = nowMinutes(now);

  // beim Öffnen zur aktuellen Uhrzeit scrollen
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isToday && trackW + nameW > el.clientWidth) el.scrollLeft = Math.max(0, x(nowM) - (el.clientWidth - nameW) / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, trackW > 0]);

  const hours: number[] = [];
  for (let h = rangeStart; h <= rangeEnd; h += 60) hours.push(h);

  return (
    <div ref={scrollRef} className="relative overflow-x-auto rounded-2xl border border-stone-200 bg-white">
      <div style={{ width: nameW + trackW }} className="relative">
        {/* Kopfzeile mit Stunden */}
        <div className="sticky top-0 z-[25] flex h-9 border-b border-stone-200 bg-stone-50">
          <div style={{ width: nameW }} className="sticky left-0 z-30 shrink-0 border-r border-stone-200 bg-stone-50 px-3 text-xs font-semibold leading-9 text-stone-500">
            Mitarbeiter
          </div>
          <div className="relative" style={{ width: trackW }}>
            {hours.map((h) => (
              <div key={h} className="absolute top-0 h-full border-l border-stone-200 pl-1 text-xs leading-9 text-stone-500" style={{ left: x(h) }}>
                {fmtMin(h)}
              </div>
            ))}
          </div>
        </div>

        {/* Hintergrund: Raster, Überlast-Zeiträume, Jetzt-Linie */}
        <div className="pointer-events-none absolute bottom-0 top-9 z-0" style={{ left: nameW, width: trackW }}>
          {hours.map((h) => (
            <div key={h} className="absolute top-0 h-full border-l border-stone-100" style={{ left: x(h) }} />
          ))}
          {hours.slice(0, -1).map((h) => (
            <div key={`h${h}`} className="absolute top-0 h-full border-l border-dashed border-stone-100" style={{ left: x(h + 30) }} />
          ))}
          {issues.overCapacity.map((o) => (
            <div key={o.from} className="absolute top-0 h-full bg-red-500/10" style={{ left: x(o.from), width: (o.to - o.from) * ppm }} title={`${o.count} gleichzeitig in Pause`} />
          ))}
        </div>
        {isToday && nowM >= rangeStart && nowM <= rangeEnd && (
          <div className="pointer-events-none absolute bottom-0 top-0 z-[15]" style={{ left: nameW + x(nowM) }}>
            <div className="h-full w-0.5 bg-red-600" />
            <div className="absolute -left-6 top-1 rounded bg-red-600 px-1.5 text-[11px] font-bold text-white">{fmtMin(nowM)}</div>
          </div>
        )}

        {shifts.map((s) => (
          <Row
            key={s.id}
            shift={s}
            pauses={pausesByShift.get(s.id) ?? []}
            issues={issues}
            nameW={nameW}
            trackW={trackW}
            ppm={ppm}
            x={x}
            readOnly={readOnly}
            rowH={ROW_H}
            now={now}
            onOpenShift={onOpenShift}
            onOpenPause={onOpenPause}
          />
        ))}
        {shifts.length === 0 && <div className="p-8 text-center text-stone-500">Keine Mitarbeiter im Plan.</div>}
      </div>
    </div>
  );
}

function Row({ shift, pauses, issues, nameW, trackW, ppm, x, readOnly, rowH: ROW_H, now, onOpenShift, onOpenPause }: {
  shift: ShiftEntry; pauses: PauseBlock[]; issues: PlanIssues; nameW: number; trackW: number; ppm: number; x: (m: number) => number; readOnly: boolean; rowH: number; now: Date;
  onOpenShift: (id: string) => void; onOpenPause: (id: string) => void;
}) {
  const win = shiftWindow(shift);
  const shiftIssues = issues.byShift[shift.id] ?? [];
  const blockIssueCount = pauses.reduce((a, p) => a + (issues.byBlock[p.id]?.length ?? 0), 0);
  const hasError = shiftIssues.some((i) => i.severity === 'error') || pauses.some((p) => issues.byBlock[p.id]?.some((i) => i.severity === 'error'));
  const notWorking = !win;

  return (
    <div className={`relative flex border-b border-stone-100 ${notWorking ? 'bg-stone-50' : ''}`} style={{ height: ROW_H }}>
      <button
        onClick={() => onOpenShift(shift.id)}
        style={{ width: nameW }}
        className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-0.5 border-r border-stone-200 bg-white px-3 text-left hover:bg-stone-50"
      >
        <span className={`flex items-center gap-1 truncate font-semibold ${notWorking ? 'text-stone-400 line-through' : ''}`}>
          {shift.is_manual && <UserPlus size={14} className="shrink-0 text-violet-600" />}
          <span className="truncate">{shift.employee_name}</span>
          {(shiftIssues.length > 0 || blockIssueCount > 0) && <AlertTriangle size={15} className={`shrink-0 ${hasError ? 'text-red-600' : 'text-amber-500'}`} />}
          {shift.note && <StickyNote size={14} className="shrink-0 text-stone-400" />}
        </span>
        <span className="flex items-center gap-1 text-xs text-stone-500">
          {shift.status !== 'present' ? <Badge tone={STATUS_TONE[shift.status]}>{SHIFT_STATUS_LABEL[shift.status]}</Badge> : win ? `${fmtMin(win.start)}–${fmtMin(win.end)}` : ''}
        </span>
      </button>
      <div className="relative" style={{ width: trackW }}>
        {/* Soll-Schicht (gestrichelt) */}
        {shift.planned_start_min != null && shift.planned_end_min != null && (
          <div
            className="absolute top-3 rounded-lg border-2 border-dashed border-stone-300"
            style={{ left: x(shift.planned_start_min), width: (shift.planned_end_min - shift.planned_start_min) * ppm, height: ROW_H - 24 }}
          />
        )}
        {/* Ist-Schicht */}
        {win && (
          <div
            className={`absolute top-3 rounded-lg ${shift.is_manual ? 'bg-violet-100' : 'bg-brand-100'} ${shiftIssues.some((i) => i.severity === 'error') ? 'ring-2 ring-red-400' : ''}`}
            style={{ left: x(win.start), width: (win.end - win.start) * ppm, height: ROW_H - 24 }}
            title={shiftIssues.map((i) => i.text).join('\n')}
          />
        )}
        {pauses.map((p) => (
          <PauseBar key={p.id} p={p} x={x} ppm={ppm} rowH={ROW_H} issues={issues.byBlock[p.id] ?? []} readOnly={readOnly || notWorking} now={now} onOpen={() => onOpenPause(p.id)} />
        ))}
      </div>
    </div>
  );
}

function PauseBar({ p, x, ppm, rowH: ROW_H, issues, readOnly, now, onOpen }: { p: PauseBlock; x: (m: number) => number; ppm: number; rowH: number; issues: { severity: string; text: string }[]; readOnly: boolean; now: Date; onOpen: () => void }) {
  const [drag, setDrag] = useState<{ startX: number; delta: number; moved: boolean } | null>(null);
  const draggable = !readOnly && p.status === 'open';
  const span = blockSpan(p, now);
  const deltaMin = drag ? Math.round(drag.delta / ppm / SNAP) * SNAP : 0;
  const start = span.from + deltaMin;
  const w = Math.max(ROW_H * 0.5, (span.to - span.from) * ppm);
  const err = issues.some((i) => i.severity === 'error');
  const warn = !err && issues.length > 0;

  const onDown = (e: RPointerEvent) => {
    if (!draggable) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ startX: e.clientX, delta: 0, moved: false });
  };
  const onMove = (e: RPointerEvent) => {
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    setDrag({ ...drag, delta, moved: drag.moved || Math.abs(delta) > 6 });
  };
  const onUp = () => {
    if (drag?.moved && deltaMin !== 0) movePause(p.id, p.start_min + deltaMin);
    else if (!drag?.moved) onOpen();
    setDrag(null);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={draggable ? onUp : undefined}
      onPointerCancel={() => setDrag(null)}
      onClick={draggable ? undefined : onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className={`absolute top-2 z-10 flex select-none flex-col items-center justify-center overflow-hidden rounded-lg border-2 text-[0.7rem] font-bold leading-tight shadow-sm ${pauseClasses(p)} ${err ? '!border-red-600 ring-2 ring-red-500' : warn ? '!border-orange-500 ring-2 ring-orange-400' : ''} ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer'} ${drag?.moved ? 'z-30 opacity-90 shadow-xl' : ''}`}
      style={{ left: x(start), width: w, height: ROW_H - 16 }}
      title={[`Block ${p.block_no}: ${fmtMin(start)} · ${p.planned_duration_min} Min.`, ...issues.map((i) => i.text)].join('\n')}
    >
      <span className="flex items-center gap-0.5">
        {(err || warn) && <AlertTriangle size={11} />}B{p.block_no}
      </span>
      <span className="tabular-nums">{fmtMin(start)}</span>
    </div>
  );
}
