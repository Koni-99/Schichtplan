import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Ban, Check, Clock, Minus, Play, Plus, RotateCcw, Send, Square, Trash2 } from 'lucide-react';
import { useDB } from '../../store/db';
import {
  addPauseBlock, addSpringer, cancelPause, closePlan, endPause, movePause, removeShift, resetPause, setActualTimes,
  setNote, setPauseActual, setPauseDuration, setShiftStatus, startPause, swapShifts,
} from '../../store/actions';
import type { PauseBlock, ShiftEntry, ShiftStatus } from '../../lib/types';
import { SHIFT_STATUS_LABEL } from '../../lib/types';
import type { PlanIssues } from '../../lib/validation';
import { fmtCountdown, fmtMin, minutesBetween, nowMinutes } from '../../lib/time';
import { shiftWindow } from '../../lib/pauseRules';
import { computeActualPause, diffPlan, planHasDeviations } from '../../lib/diff';
import { Badge, Button, Field, inputCls, Modal, TimeInput, toast, useNow } from '../../components/ui';
import { PAUSE_STATUS_LABEL } from './styles';

const roundNow = (step = 5) => Math.round(nowMinutes() / step) * step;

// ------------------------------------------------------------------ Pausenblock bearbeiten
export function PauseEditor({ id, issues, readOnly, onClose }: { id: string | null; issues: PlanIssues; readOnly: boolean; onClose: () => void }) {
  const p = useDB((s) => (id ? s.pauses[id] : undefined));
  const shift = useDB((s) => (p ? s.shifts[p.shift_entry_id] : undefined));
  const now = useNow(1000);
  const [actualStart, setActualStart] = useState<number | null>(null);
  const [actualDur, setActualDur] = useState<number>(30);
  useEffect(() => {
    if (p) {
      setActualStart(p.start_min);
      setActualDur(p.actual_duration_min ?? p.planned_duration_min);
    }
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p || !shift) return null;
  const bi = issues.byBlock[p.id] ?? [];
  const elapsed = p.status === 'running' && p.actual_start_at ? minutesBetween(p.actual_start_at, now) : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span>
          {shift.employee_name} · Block {p.block_no} <Badge tone={p.status === 'running' ? 'amber' : p.status === 'done' ? 'green' : p.status === 'cancelled' ? 'stone' : 'blue'}>{PAUSE_STATUS_LABEL[p.status]}</Badge>
        </span>
      }
    >
      <div className="space-y-4">
        {bi.map((i) => (
          <div key={i.text} className={`flex items-center gap-2 rounded-xl p-3 text-sm font-medium ${i.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-orange-50 text-orange-800'}`}>
            <AlertTriangle size={16} /> {i.text}
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-stone-50 p-3 text-sm">
          <div>
            <div className="text-stone-500">Geplant</div>
            <div className="text-xl font-bold tabular-nums">{fmtMin(p.start_min)}–{fmtMin(p.start_min + p.planned_duration_min)}</div>
          </div>
          <div>
            <div className="text-stone-500">Soll-Dauer</div>
            <div className="text-xl font-bold">{p.planned_duration_min} Min.{p.is_fixed && <Badge tone="violet" className="ml-2">fest</Badge>}</div>
          </div>
          {p.status === 'running' && (
            <div className="col-span-2">
              <div className="text-stone-500">Restzeit (gestartet {p.actual_start_at && new Date(p.actual_start_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })})</div>
              <div className={`text-4xl font-bold tabular-nums ${p.planned_duration_min - elapsed < 0 ? 'text-red-600' : ''}`}>{fmtCountdown(p.planned_duration_min - elapsed)}</div>
            </div>
          )}
          {p.status === 'done' && (
            <div className="col-span-2">
              <div className="text-stone-500">Ist-Dauer</div>
              <div className={`text-xl font-bold ${p.actual_duration_min !== p.planned_duration_min ? 'text-orange-700' : ''}`}>{p.actual_duration_min ?? '–'} Min.</div>
            </div>
          )}
        </div>

        {!readOnly && (
          <>
            {p.status === 'open' && (
              <Button variant="warning" size="lg" className="w-full" icon={<Play />} onClick={() => { startPause(p.id); onClose(); }}>
                Pause jetzt starten
              </Button>
            )}
            {p.status === 'running' && (
              <Button variant="success" size="lg" className="w-full" icon={<Square />} onClick={() => { endPause(p.id); onClose(); }}>
                Pause beenden
              </Button>
            )}
            {p.status === 'open' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-stone-700">Verschieben</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button icon={<Minus size={18} />} onClick={() => movePause(p.id, p.start_min - 15)}>15 Min.</Button>
                  <Button icon={<Plus size={18} />} onClick={() => movePause(p.id, p.start_min + 15)}>15 Min.</Button>
                  <span className="ml-2 text-sm text-stone-600">Uhrzeit:</span>
                  <TimeInput value={p.start_min} onChange={(m) => m != null && movePause(p.id, m)} aria-label="Startzeit wählen" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-stone-600">Dauer:</span>
                  {[15, 20, 30, 45].map((d) => (
                    <Button key={d} size="sm" variant={p.planned_duration_min === d ? 'primary' : 'secondary'} onClick={() => setPauseDuration(p.id, d)}>
                      {d} Min.
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {(p.status === 'open' || p.status === 'done') && (
              <div className="space-y-2 rounded-xl border border-stone-200 p-3">
                <div className="text-sm font-semibold text-stone-700">{p.status === 'done' ? 'Ist-Pause korrigieren' : 'Nachträglich als genommen eintragen'}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <TimeInput value={actualStart} onChange={setActualStart} aria-label="Ist-Beginn" />
                  <input type="number" min={0} max={120} className={`${inputCls} !w-24 text-center`} value={actualDur} onChange={(e) => setActualDur(Number(e.target.value))} aria-label="Ist-Dauer in Minuten" />
                  <span className="text-sm text-stone-600">Min.</span>
                  <Button variant="primary" icon={<Check size={18} />} onClick={() => { if (actualStart != null) { setPauseActual(p.id, actualStart, actualDur); toast('Ist-Pause gespeichert', 'success'); } }}>
                    Speichern
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-stone-200 pt-3">
              {p.status !== 'open' && (
                <Button variant="ghost" icon={<RotateCcw size={18} />} onClick={() => resetPause(p.id)}>Auf „Offen“ zurücksetzen</Button>
              )}
              {p.status === 'open' && (
                <Button variant="ghost" className="text-red-700" icon={<Ban size={18} />} onClick={() => { cancelPause(p.id); onClose(); }}>Pause streichen</Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Mitarbeiter-Tagespanel
const STATUS_ORDER: ShiftStatus[] = ['present', 'sick', 'left_early', 'came_late', 'absent'];

export function ShiftPanel({ id, issues, readOnly, onClose, onOpenPause }: { id: string | null; issues: PlanIssues; readOnly: boolean; onClose: () => void; onOpenPause: (id: string) => void }) {
  const shift = useDB((s) => (id ? s.shifts[id] : undefined));
  const pausesAll = useDB((s) => s.pauses);
  const settings = useDB((s) => s.settings);
  const pauses = useMemo(() => Object.values(pausesAll).filter((p) => p.shift_entry_id === id && !p.deleted_at).sort((a, b) => a.block_no - b.block_no), [pausesAll, id]);
  const [note, setNoteText] = useState('');
  const [timeFor, setTimeFor] = useState<ShiftStatus | null>(null);
  const [statusTime, setStatusTime] = useState<number | null>(null);
  useEffect(() => setNoteText(shift?.note ?? ''), [shift?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shift) return null;
  const win = shiftWindow(shift);
  const si = issues.byShift[shift.id] ?? [];
  const istPause = computeActualPause({ ...shift, actual_pause_min: null }, pauses, settings);

  const chooseStatus = (st: ShiftStatus) => {
    if (st === 'left_early' || st === 'came_late') {
      setTimeFor(st);
      setStatusTime(roundNow());
      return;
    }
    setShiftStatus(shift.id, st);
  };

  return (
    <Modal
      open
      onClose={() => { setNote(shift.id, note); onClose(); }}
      title={<span className="flex items-center gap-2">{shift.employee_name}{shift.is_manual && <Badge tone="violet">Manuell ergänzt</Badge>}</span>}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-stone-50 p-3 text-sm">
          <div><div className="text-stone-500">Soll (PEPZeit)</div><div className="font-bold tabular-nums">{shift.planned_start_min != null ? `${fmtMin(shift.planned_start_min)}–${fmtMin(shift.planned_end_min)}` : '–'}</div></div>
          <div><div className="text-stone-500">Ist</div><div className="font-bold tabular-nums">{win ? `${fmtMin(win.start)}–${fmtMin(win.end)}` : '–'}</div></div>
          <div><div className="text-stone-500">Pause Soll / Ist</div><div className="font-bold">{shift.planned_pause_min} / {istPause} Min.</div></div>
        </div>
        {si.map((i) => (
          <div key={i.text} className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800"><AlertTriangle size={16} />{i.text}</div>
        ))}

        <div>
          <div className="mb-2 text-sm font-semibold text-stone-700">Status</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STATUS_ORDER.map((st) => (
              <Button key={st} disabled={readOnly} variant={shift.status === st ? (st === 'sick' || st === 'absent' ? 'danger' : 'primary') : 'secondary'} onClick={() => chooseStatus(st)}>
                {SHIFT_STATUS_LABEL[st]}
              </Button>
            ))}
          </div>
          {timeFor && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3">
              <span className="text-sm font-semibold">{timeFor === 'left_early' ? 'Gegangen um' : 'Gekommen um'}</span>
              <TimeInput value={statusTime} onChange={setStatusTime} />
              <Button variant="primary" onClick={() => { if (statusTime != null) setShiftStatus(shift.id, timeFor, statusTime); setTimeFor(null); }}>Übernehmen</Button>
              <Button variant="ghost" onClick={() => setTimeFor(null)}>Abbrechen</Button>
            </div>
          )}
        </div>

        {win && !readOnly && (
          <div>
            <div className="mb-2 text-sm font-semibold text-stone-700">Ist-Arbeitszeit</div>
            <div className="flex items-center gap-2">
              <TimeInput value={shift.actual_start_min ?? shift.planned_start_min} onChange={(m) => setActualTimes(shift.id, m, shift.actual_end_min)} aria-label="Ist-Beginn" />
              <span>–</span>
              <TimeInput value={shift.actual_end_min ?? shift.planned_end_min} onChange={(m) => setActualTimes(shift.id, shift.actual_start_min, m)} aria-label="Ist-Ende" />
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-stone-700">Pausenblöcke</span>
            {!readOnly && win && (
              <Button size="sm" icon={<Plus size={16} />} onClick={() => addPauseBlock(shift.id, Math.min(Math.max(roundNow(15), win.start), win.end - 15), 15)}>Block</Button>
            )}
          </div>
          <div className="space-y-2">
            {pauses.length === 0 && <p className="text-sm text-stone-500">Keine Pausen geplant.</p>}
            {pauses.map((p: PauseBlock) => (
              <button key={p.id} onClick={() => onOpenPause(p.id)} className="flex min-h-12 w-full items-center justify-between rounded-xl border border-stone-200 px-3 text-left hover:bg-stone-50">
                <span className="font-semibold">Block {p.block_no} · {fmtMin(p.start_min)} · {p.planned_duration_min} Min.</span>
                <span className="flex items-center gap-2 text-sm">
                  {(issues.byBlock[p.id]?.length ?? 0) > 0 && <AlertTriangle size={14} className="text-orange-600" />}
                  {PAUSE_STATUS_LABEL[p.status]}{p.status === 'done' && ` (${p.actual_duration_min} Min.)`}
                </span>
              </button>
            ))}
          </div>
        </div>

        <Field label="Notiz (für die Personalleitung)">
          <textarea
            disabled={readOnly}
            className={`${inputCls} min-h-24 py-2`}
            placeholder="z. B. Pause 2 wegen Kundenandrang verkürzt"
            value={note}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={() => setNote(shift.id, note)}
          />
        </Field>

        {!readOnly && shift.is_manual && (
          <Button variant="ghost" className="text-red-700" icon={<Trash2 size={18} />} onClick={() => { if (window.confirm(`${shift.employee_name} aus dem Plan entfernen?`)) { removeShift(shift.id); onClose(); } }}>
            Springer entfernen
          </Button>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Springer / Aushilfe
export function SpringerModal({ planId, open, onClose }: { planId: string; open: boolean; onClose: () => void }) {
  const employeesAll = useDB((s) => s.employees);
  const employees = useMemo(() => Object.values(employeesAll).filter((e) => !e.deleted_at && e.active).sort((a, b) => a.name.localeCompare(b.name, 'de')), [employeesAll]);
  const [name, setName] = useState('');
  const [start, setStart] = useState<number | null>(roundNow(15));
  const [end, setEnd] = useState<number | null>(null);
  const [withPauses, setWithPauses] = useState(true);
  useEffect(() => {
    if (open) { setName(''); setStart(roundNow(15)); setEnd(null); setWithPauses(true); }
  }, [open]);
  const valid = name.trim().length >= 2 && start != null && end != null && end > start;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Springer / Aushilfe hinzufügen"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!valid} onClick={() => { addSpringer(planId, name, start!, end!, withPauses); toast(`${name} hinzugefügt (manuell ergänzt)`, 'success'); onClose(); }}>
            Hinzufügen
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" hint="Bekannte Mitarbeiter werden vorgeschlagen. Der Eintrag wird für die Personalleitung als „Manuell ergänzt“ markiert.">
          <input list="emp-list" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <datalist id="emp-list">{employees.map((e) => <option key={e.id} value={e.name} />)}</datalist>
        </Field>
        <div className="flex items-end gap-3">
          <Field label="Beginn"><TimeInput value={start} onChange={setStart} /></Field>
          <Field label="Ende"><TimeInput value={end} onChange={setEnd} /></Field>
        </div>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" className="h-6 w-6" checked={withPauses} onChange={(e) => setWithPauses(e.target.checked)} />
          Pausen automatisch einplanen (laut Profil/Standard)
        </label>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Schicht tauschen
export function SwapModal({ shifts, open, onClose }: { shifts: ShiftEntry[]; open: boolean; onClose: () => void }) {
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  useEffect(() => { if (open) { setA(null); setB(null); } }, [open]);
  const pick = (id: string) => {
    if (a === id) setA(null);
    else if (b === id) setB(null);
    else if (!a) setA(id);
    else setB(id);
  };
  const sa = shifts.find((s) => s.id === a), sb = shifts.find((s) => s.id === b);
  const label = (s: ShiftEntry) => { const w = shiftWindow(s); return w ? `${fmtMin(w.start)}–${fmtMin(w.end)}` : SHIFT_STATUS_LABEL[s.status]; };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schicht tauschen"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon={<ArrowLeftRight size={18} />} disabled={!sa || !sb} onClick={() => { swapShifts(a!, b!); toast('Schichten getauscht', 'success'); onClose(); }}>
            Tauschen
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-stone-600">Zwei Mitarbeiter auswählen. Schichtzeiten und Pausenblöcke werden zwischen beiden getauscht.</p>
      {sa && sb && (
        <div className="mb-3 rounded-xl bg-brand-50 p-3 text-sm">
          <b>{sa.employee_name}</b> übernimmt {label(sb)} · <b>{sb.employee_name}</b> übernimmt {label(sa)}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {shifts.map((s) => {
          const sel = s.id === a ? 1 : s.id === b ? 2 : 0;
          return (
            <button key={s.id} onClick={() => pick(s.id)} className={`flex min-h-12 items-center justify-between rounded-xl border-2 px-3 text-left ${sel ? 'border-brand-700 bg-brand-50' : 'border-stone-200'}`}>
              <span className="font-semibold">{s.employee_name}</span>
              <span className="text-sm tabular-nums text-stone-500">{sel ? <Badge tone="brand">{sel}</Badge> : label(s)}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Tag abschließen
export function CloseDayModal({ planId, open, onClose }: { planId: string; open: boolean; onClose: () => void }) {
  const plan = useDB((s) => s.plans[planId]);
  const shiftsAll = useDB((s) => s.shifts);
  const pausesAll = useDB((s) => s.pauses);
  const settings = useDB((s) => s.settings);
  const shifts = useMemo(() => Object.values(shiftsAll).filter((x) => x.plan_id === planId && !x.deleted_at), [shiftsAll, planId]);
  const pauses = useMemo(() => Object.values(pausesAll).filter((x) => x.plan_id === planId && !x.deleted_at), [pausesAll, planId]);
  if (!plan) return null;
  const running = pauses.filter((p) => p.status === 'running').length;
  const notStarted = pauses.filter((p) => p.status === 'open' && shifts.find((s) => s.id === p.shift_entry_id && shiftWindow(s))).length;
  const diffs = diffPlan(plan, shifts, pauses, settings);
  const devCount = diffs.filter((d) => d.kinds.length).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tag abschließen & an Personalleitung senden"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon={<Send size={18} />} onClick={() => { closePlan(planId, 'manual'); toast('Tag abgeschlossen und an die Personalleitung gesendet', 'success'); onClose(); }}>
            Jetzt abschließen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p>Der Tagesplan wird archiviert und ist danach nicht mehr bearbeitbar. Die Personalleitung erhält einen Hinweis.</p>
        {running > 0 && <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-amber-900"><Clock size={18} />{running} laufende Pause(n) werden jetzt beendet.</div>}
        {notStarted > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-orange-50 p-3 text-orange-900">
            <AlertTriangle size={18} />
            {notStarted} Pause(n) wurden nicht gestartet und zählen {settings.count_unstarted_as_taken ? 'als planmäßig genommen' : 'als nicht genommen'}.
          </div>
        )}
        <div className={`rounded-xl p-3 ${planHasDeviations(diffs) ? 'bg-red-50 text-red-900' : 'bg-emerald-50 text-emerald-900'}`}>
          {devCount > 0 ? `${devCount} Mitarbeiter mit Soll/Ist-Abweichungen` : 'Keine Soll/Ist-Abweichungen'}
        </div>
      </div>
    </Modal>
  );
}
