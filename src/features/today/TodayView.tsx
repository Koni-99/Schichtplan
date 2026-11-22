import { useMemo, useState } from 'react';
import { AlertTriangle, ArchiveRestore, ArrowLeftRight, CalendarCheck, FileUp, LayoutList, Lock, Send, Sparkles, SquareGanttChart, Undo2, UserPlus } from 'lucide-react';
import { useDB, undoLast } from '../../store/db';
import { useAuth } from '../../store/auth';
import { autoSchedule, setShiftStatus } from '../../store/actions';
import { fmtDate, fmtMin, todayISO } from '../../lib/time';
import { Badge, Button, toast, useNow } from '../../components/ui';
import { usePlanData } from './usePlanData';
import { PauseNowBar } from './PauseNowBar';
import { Timeline } from './Timeline';
import { CompactList } from './CompactList';
import { CloseDayModal, PauseEditor, ShiftPanel, SpringerModal, SwapModal } from './Dialogs';

type Mode = 'timeline' | 'list';
const MODE_KEY = 'pausenplaner-view-mode';

export function TodayView({ onGoImport }: { onGoImport?: () => void }) {
  const now = useNow(1000);
  const plans = useDB((s) => s.plans);
  const undo = useDB((s) => s.undo);
  const role = useAuth((s) => s.role);
  const today = todayISO();

  const openPlans = useMemo(() => Object.values(plans).filter((p) => !p.deleted_at && (p.status === 'open' || p.plan_date === today)).sort((a, b) => a.plan_date.localeCompare(b.plan_date)), [plans, today]);
  const [selected, setSelected] = useState<string | null>(null);
  // heute, sonst der nächste anstehende Tag, sonst der letzte offene
  const openOnly = openPlans.filter((p) => p.status === 'open');
  const defaultPlan = openPlans.find((p) => p.plan_date === today) ?? openOnly.find((p) => p.plan_date > today) ?? openOnly.at(-1);
  const planId = selected && plans[selected] && !plans[selected].deleted_at ? selected : defaultPlan?.id;

  const { plan, shifts: allShifts, pauses, pausesByShift, settings, issues } = usePlanData(planId, now);
  const shifts = useMemo(() => allShifts.filter((s) => s.status !== 'removed'), [allShifts]);
  const removed = useMemo(() => allShifts.filter((s) => s.status === 'removed'), [allShifts]);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) ?? (window.innerWidth < 640 ? 'list' : 'timeline'));
  const [shiftOpen, setShiftOpen] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState<string | null>(null);
  const [springer, setSpringer] = useState(false);
  const [swap, setSwap] = useState(false);
  const [closing, setClosing] = useState(false);

  const setModeP = (m: Mode) => { setMode(m); localStorage.setItem(MODE_KEY, m); };

  if (!plan) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <CalendarCheck size={56} className="text-stone-300" />
        <h2 className="text-2xl font-bold">Kein Tagesplan für heute</h2>
        <p className="text-stone-600">{onGoImport ? 'Laden Sie den PEPZeit-Wochenplan als PDF hoch, um die Tagespläne zu erstellen.' : 'Die Personalleitung muss zuerst den PEPZeit-Wochenplan hochladen.'}</p>
        {onGoImport && <Button variant="primary" size="lg" icon={<FileUp />} onClick={onGoImport}>PEPZeit-PDF importieren</Button>}
      </div>
    );
  }

  // Personalleitung sieht Tagespläne nur an – Änderungen macht die Filiale
  const readOnly = plan.status === 'closed' || role === 'personalleitung';
  const isToday = plan.plan_date === today;
  const planUndo = undo.filter((u) => u.planId === plan.id);
  const errorCount = Object.values(issues.byBlock).flat().filter((i) => i.severity === 'error').length + Object.values(issues.byShift).flat().length;
  const warnCount = Object.values(issues.byBlock).flat().filter((i) => i.severity === 'warn').length;
  const minutesToAuto = settings.auto_close_enabled && isToday && !readOnly ? settings.auto_close_time - (now.getHours() * 60 + now.getMinutes()) : null;

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 p-3 pb-24 sm:p-4">
      {/* Kopf: Datum + Planwahl */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold">{fmtDate(plan.plan_date, { weekday: 'long', day: '2-digit', month: 'long' })}</h1>
        {plan.status === 'closed' ? <Badge tone="stone"><Lock size={12} /> {plan.closed_label ?? 'Abgeschlossen'}</Badge> : <Badge tone="green">Offen</Badge>}
        {role === 'personalleitung' && plan.status === 'open' && <Badge tone="blue">Nur Ansicht</Badge>}
        {!isToday && !readOnly && <Badge tone="amber">Nicht heute</Badge>}
        {minutesToAuto !== null && minutesToAuto > 0 && minutesToAuto <= 60 && (
          <Badge tone="amber">Auto-Abschluss um {fmtMin(settings.auto_close_time)} (in {minutesToAuto} Min.)</Badge>
        )}
        {openPlans.length > 1 && (
          <div className="ml-auto flex flex-wrap gap-1">
            {openPlans.map((p) => (
              <button key={p.id} onClick={() => setSelected(p.id)} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${p.id === plan.id ? 'bg-brand-700 text-white' : 'bg-white text-stone-700 ring-1 ring-stone-300'}`}>
                {fmtDate(p.plan_date, { weekday: 'short', day: '2-digit', month: '2-digit' })}
              </button>
            ))}
          </div>
        )}
      </div>

      <PauseNowBar shifts={shifts} pauses={pauses} max={settings.max_concurrent_pauses} now={now} readOnly={readOnly} isToday={isToday} />

      {/* Aktionen */}
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <>
            <Button variant="primary" icon={<Sparkles size={18} />} onClick={() => {
              const w = autoSchedule(plan.id);
              if (w.length) w.forEach((x) => toast(x, 'error'));
              else toast('Pausen automatisch geplant', 'success', { label: 'Rückgängig', run: () => undoLast() });
            }}>
              Pausen automatisch planen
            </Button>
            <Button icon={<UserPlus size={18} />} onClick={() => setSpringer(true)}>Springer</Button>
            <Button icon={<ArrowLeftRight size={18} />} onClick={() => setSwap(true)}>Schicht tauschen</Button>
            <Button
              icon={<Undo2 size={18} />}
              disabled={planUndo.length === 0}
              onClick={() => { const l = undoLast(); if (l) toast(`Rückgängig: ${l}`); }}
              title={planUndo.map((u, i) => `${i + 1}. ${u.label}`).join('\n') || 'Nichts rückgängig zu machen'}
            >
              Rückgängig{planUndo.length > 0 && <span className="rounded-full bg-stone-200 px-2 text-xs">{planUndo.length}</span>}
            </Button>
          </>
        )}
        <div className="ml-auto flex rounded-xl bg-stone-200 p-1">
          <button onClick={() => setModeP('timeline')} className={`flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-semibold ${mode === 'timeline' ? 'bg-white shadow' : 'text-stone-600'}`}>
            <SquareGanttChart size={16} /> Zeitstrahl
          </button>
          <button onClick={() => setModeP('list')} className={`flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-semibold ${mode === 'list' ? 'bg-white shadow' : 'text-stone-600'}`}>
            <LayoutList size={16} /> Liste
          </button>
        </div>
      </div>

      {(errorCount > 0 || warnCount > 0) && (
        <div className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${errorCount ? 'bg-red-50 text-red-800' : 'bg-orange-50 text-orange-800'}`}>
          <AlertTriangle size={16} />
          {errorCount > 0 && <span>{errorCount} Regelverstöße</span>}
          {warnCount > 0 && <span>{warnCount} Hinweise zu Abständen</span>}
          {issues.overCapacity.map((o) => (
            <span key={o.from} className="rounded bg-red-100 px-2">{fmtMin(o.from)}–{fmtMin(o.to)}: {o.count} gleichzeitig</span>
          ))}
          <span className="text-stone-500">· wird nicht blockiert, bitte bewusst entscheiden</span>
        </div>
      )}

      {mode === 'timeline' ? (
        <Timeline shifts={shifts} pausesByShift={pausesByShift} issues={issues} isToday={isToday} readOnly={readOnly} now={now} onOpenShift={setShiftOpen} onOpenPause={setPauseOpen} />
      ) : (
        <CompactList shifts={shifts} pausesByShift={pausesByShift} issues={issues} readOnly={readOnly} now={now} onOpenShift={setShiftOpen} onOpenPause={setPauseOpen} />
      )}

      {removed.length > 0 && (
        <details className="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
          <summary className="flex min-h-10 cursor-pointer items-center font-semibold text-stone-700">Aus Plan entfernt ({removed.length})</summary>
          <div className="mt-2 divide-y divide-stone-100">
            {removed.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-stone-500 line-through">{s.employee_name}</div>
                  <div className="text-sm text-stone-600">
                    {s.removed_reason} · {s.removed_by_name}
                    {s.removed_at && `, ${new Date(s.removed_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`}
                  </div>
                </div>
                {!readOnly && role === 'filialleitung' && (
                  <Button size="sm" icon={<ArchiveRestore size={16} />} onClick={() => { setShiftStatus(s.id, 'present'); toast(`${s.employee_name} wiederhergestellt`, 'success'); }}>
                    Wiederherstellen
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <Legend />

      {!readOnly && (role === 'filiale' || role === 'filialleitung') && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] justify-end">
            <Button variant="primary" size="lg" className="w-full sm:w-auto" icon={<Send />} onClick={() => setClosing(true)}>
              Tag abschließen & an Personalleitung senden
            </Button>
          </div>
        </div>
      )}

      {shiftOpen && <ShiftPanel id={shiftOpen} issues={issues} readOnly={readOnly} onClose={() => setShiftOpen(null)} onOpenPause={(id) => { setShiftOpen(null); setPauseOpen(id); }} />}
      {pauseOpen && <PauseEditor id={pauseOpen} issues={issues} readOnly={readOnly} onClose={() => setPauseOpen(null)} />}
      <SpringerModal planId={plan.id} open={springer} onClose={() => setSpringer(false)} />
      <SwapModal shifts={shifts} open={swap} onClose={() => setSwap(false)} />
      <CloseDayModal planId={plan.id} open={closing} onClose={() => setClosing(false)} />
    </div>
  );
}

function Legend() {
  const items = [
    ['bg-sky-500', 'Pause offen'],
    ['bg-violet-500', 'Feste Uhrzeit'],
    ['bg-amber-400', 'Läuft gerade'],
    ['bg-emerald-500', 'Erledigt'],
    ['bg-stone-200 stripes', 'Gestrichen'],
    ['border-2 border-dashed border-stone-400', 'Soll-Schicht'],
    ['ring-2 ring-red-500 bg-white', 'Regelverstoß'],
    ['ring-2 ring-orange-400 bg-white', 'Abstandshinweis'],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5"><span className={`inline-block h-3.5 w-5 rounded ${c}`} />{l}</span>
      ))}
    </div>
  );
}
