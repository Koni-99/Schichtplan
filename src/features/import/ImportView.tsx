import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, FileText, FileUp, Loader2, Lock, Plus, ShieldCheck, Trash2, Wand2 } from 'lucide-react';
import { parsePepzeitPdf, type WeekParseResult } from '../../lib/pdfParser';
import { fmtDate, nameKey, todayISO, uid } from '../../lib/time';
import { useDB } from '../../store/db';
import { autoCloseDuePlans, closePlan, createPlanFromImport } from '../../store/actions';
import { Badge, Button, Modal, TimeInput, inputCls, toast } from '../../components/ui';
import type { DailyPlan } from '../../lib/types';

interface EditRow { key: string; name: string; start: number | null; end: number | null }
interface EditDay { key: string; date: string; rows: EditRow[]; include: boolean; replace: boolean }

type DayState = 'new' | 'past' | 'open' | 'today-open' | 'closed' | 'invalid';

const SAMPLES = [
  { file: 'pepzeit-wochenplan-beispiel.pdf', label: 'Beispiel-Wochenplan ausprobieren' },
  { file: 'pepzeit-beispiel.pdf', label: 'Beispiel-Tagesplan' },
];

export function ImportView({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WeekParseResult | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [days, setDays] = useState<EditDay[] | null>(null);
  const [active, setActive] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const [stale, setStale] = useState<DailyPlan[] | null>(null);
  const employees = useDB((s) => s.employees);
  const plans = useDB((s) => s.plans);
  const today = todayISO();
  const knownKeys = useMemo(() => new Set(Object.values(employees).filter((e) => !e.deleted_at).map((e) => e.name_key)), [employees]);
  const planOn = (date: string) => Object.values(plans).find((p) => p.plan_date === date && !p.deleted_at);

  const stateOf = (d: EditDay): DayState => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'invalid';
    const p = planOn(d.date);
    if (p?.status === 'closed') return 'closed';
    if (p) return d.date === today ? 'today-open' : 'open';
    return d.date < today ? 'past' : 'new';
  };

  const toEditDays = (r: WeekParseResult): EditDay[] => {
    const mk = (date: string, shifts: { name: string; start: number; end: number }[]): EditDay => {
      const p = planOn(date);
      // Nur Tage ohne Plan und ab heute werden standardmäßig angelegt – bestehende bleiben unverändert
      return { key: uid(), date, rows: shifts.map((s) => ({ key: uid(), name: s.name, start: s.start, end: s.end })), include: !p && date >= today, replace: false };
    };
    const list = r.days.map((d) => mk(d.date, d.shifts));
    if (r.undated.length) list.push(mk(list.length ? '' : today, r.undated));
    return list.length ? list : [mk(today, [])];
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const r = await parsePepzeitPdf(file);
      setResult(r);
      setFilename(file.name);
      const d = toEditDays(r);
      setDays(d);
      setActive(Math.max(0, d.findIndex((x) => x.include)));
    } catch (e) {
      console.error(e);
      toast('PDF konnte nicht gelesen werden. Bitte Zeiten manuell erfassen.', 'error');
      setResult(null);
      setDays([{ key: uid(), date: today, rows: [{ key: uid(), name: '', start: null, end: null }], include: true, replace: false }]);
      setActive(0);
    } finally {
      setBusy(false);
    }
  };

  const rowErrors = (r: EditRow) => {
    const errs: string[] = [];
    if (r.name.trim().length < 2) errs.push('Name fehlt');
    if (r.start == null || r.end == null) errs.push('Zeit fehlt');
    else if (r.end <= r.start) errs.push('Ende vor Beginn');
    return errs;
  };
  const dupsOf = (d: EditDay) => {
    const seen = new Map<string, number>();
    d.rows.forEach((r) => seen.set(nameKey(r.name), (seen.get(nameKey(r.name)) ?? 0) + 1));
    return seen;
  };
  const dayErrors = (d: EditDay): string[] => {
    const errs: string[] = [];
    if (stateOf(d) === 'invalid') errs.push('Datum fehlt');
    if (d.rows.length === 0) errs.push('Keine Mitarbeiter');
    if (d.rows.some((r) => rowErrors(r).length)) errs.push('Unvollständige Zeilen');
    if ([...dupsOf(d).values()].some((n) => n > 1)) errs.push('Doppelte Namen');
    if (days && days.filter((x) => x.include && x.date === d.date).length > 1) errs.push('Datum mehrfach');
    return errs;
  };

  const willImport = (d: EditDay) => {
    const st = stateOf(d);
    if (!d.include || st === 'closed' || st === 'invalid' || st === 'past') return false;
    if (st === 'today-open') return false; // laufender Tag: nur manuell im Tagesplan änderbar
    if (st === 'open' && !d.replace) return false;
    return true;
  };
  const selected = days?.filter(willImport) ?? [];
  const valid = selected.length > 0 && selected.every((d) => dayErrors(d).length === 0);

  const updateDay = (key: string, patch: Partial<EditDay>) => setDays((ds) => ds!.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const updateRow = (dayKey: string, rowKey: string, patch: Partial<EditRow>) =>
    setDays((ds) => ds!.map((d) => (d.key === dayKey ? { ...d, rows: d.rows.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)) } : d)));

  const doCreate = () => {
    const created: string[] = [];
    try {
      for (const d of selected) {
        createPlanFromImport(d.date, d.rows.map((r) => ({ name: r.name.trim(), start: r.start!, end: r.end! })), filename, d.replace);
        created.push(fmtDate(d.date, { weekday: 'short', day: '2-digit', month: '2-digit' }));
      }
      const untouched = (days ?? []).filter((d) => !willImport(d) && (stateOf(d) === 'open' || stateOf(d) === 'today-open' || stateOf(d) === 'closed')).length;
      autoCloseDuePlans();
      toast(`${created.length} Tagesplan${created.length === 1 ? '' : 'e'} angelegt (${created.join(', ')})${untouched ? ` · ${untouched} bestehende Tage unverändert` : ''}`, 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  /** Nur echte Altlasten (offene Pläne vor heute) abfragen – der laufende Tag bleibt unberührt. */
  const start = () => {
    const minDate = selected.map((d) => d.date).sort()[0];
    const old = Object.values(plans).filter((p) => !p.deleted_at && p.status === 'open' && p.plan_date < today && p.plan_date < minDate && !selected.some((d) => d.date === p.plan_date));
    if (old.length) return setStale(old);
    doCreate();
  };

  const day = days?.[active];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 pb-28 sm:p-6">
      <h1 className="text-2xl font-bold">PEPZeit-Plan importieren</h1>

      {!days && (
        <div className="space-y-3">
          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}
            className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-brand-500/50 bg-white p-10 text-center hover:bg-brand-50"
          >
            {busy ? <Loader2 size={48} className="animate-spin text-brand-700" /> : <FileUp size={48} className="text-brand-700" />}
            <span className="text-xl font-bold">{busy ? 'PDF wird ausgelesen …' : 'Wochen- oder Tagesplan auswählen'}</span>
            <span className="text-stone-500">PDF hierher ziehen oder tippen · Tage, Namen und Schichtzeiten werden automatisch erkannt</span>
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
            <ShieldCheck size={18} className="mt-0.5 shrink-0" />
            <span>Abgeschlossene Tage und der <b>heutige Tag</b> werden beim Import <b>nie verändert</b> – Änderungen am heutigen Tag bitte direkt im Tagesplan vornehmen. Neu angelegt werden nur Tage, für die es noch keinen Plan gibt.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <Button
                key={s.file}
                icon={<FileText size={18} />}
                disabled={busy}
                onClick={async () => {
                  const res = await fetch(`${import.meta.env.BASE_URL}${s.file}`);
                  void onFile(new File([await res.blob()], s.file, { type: 'application/pdf' }));
                }}
              >
                {s.label}
              </Button>
            ))}
            <Button variant="ghost" icon={<Plus size={18} />} onClick={() => { setResult(null); setFilename(null); setDays([{ key: uid(), date: today, rows: [{ key: uid(), name: '', start: null, end: null }], include: true, replace: false }]); setActive(0); }}>
              Ohne PDF manuell erfassen
            </Button>
          </div>
        </div>
      )}

      {days && day && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
            <div className="text-sm text-stone-600">
              {filename && <div className="flex items-center gap-1 font-semibold text-stone-800"><FileText size={14} /> {filename}</div>}
              <div>
                {days.length} Tag{days.length === 1 ? '' : 'e'} erkannt
                {result && ` · ${result.layout === 'columns' ? 'Wochentabelle' : result.layout === 'pages' ? 'Eine Seite pro Tag' : result.layout === 'sections' ? 'Abschnitte pro Tag' : 'Tagesplan'}`}
              </div>
            </div>
            <Button variant="ghost" className="ml-auto" onClick={() => { setDays(null); setResult(null); }}>Andere Datei</Button>
          </div>

          {result?.warnings.map((w) => (
            <div key={w} className="flex items-center gap-2 rounded-xl bg-orange-50 p-3 text-sm text-orange-900"><AlertTriangle size={16} />{w}</div>
          ))}

          {/* Übersicht: was passiert mit jedem Tag? */}
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
            <div className="border-b border-stone-200 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600">Was passiert mit welchem Tag?</div>
            <div className="divide-y divide-stone-100">
              {days.map((d, i) => {
                const st = stateOf(d);
                const imp = willImport(d);
                const errs = imp ? dayErrors(d) : [];
                return (
                  <div key={d.key} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${i === active ? 'bg-brand-50' : ''}`}>
                    <label className="flex min-h-12 items-center gap-3">
                      <input
                        type="checkbox"
                        className="h-6 w-6"
                        disabled={st === 'closed' || st === 'past' || st === 'today-open'}
                        checked={st === 'open' ? d.replace : d.include && st !== 'closed' && st !== 'past' && st !== 'today-open'}
                        onChange={(e) => (st === 'open' ? updateDay(d.key, { replace: e.target.checked, include: true }) : updateDay(d.key, { include: e.target.checked }))}
                        aria-label={`${d.date} importieren`}
                      />
                      <span className="w-36 font-semibold">{d.date ? fmtDate(d.date, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Ohne Datum'}</span>
                    </label>
                    <span className="flex-1 text-sm">
                      {st === 'closed' && <Badge tone="stone"><Lock size={12} /> Abgeschlossen – bleibt unverändert</Badge>}
                      {st === 'today-open' && <Badge tone="green"><ShieldCheck size={12} /> Heute laufend – bleibt unverändert (Änderungen direkt im Tagesplan)</Badge>}
                      {st === 'open' && (d.replace ? <Badge tone="red">Bestehender Plan wird ersetzt</Badge> : <Badge tone="green">Plan vorhanden – bleibt unverändert</Badge>)}
                      {st === 'new' && (d.include ? <Badge tone="blue">Wird neu angelegt</Badge> : <Badge>Wird übersprungen</Badge>)}
                      {st === 'past' && <Badge>Vergangen – wird nicht angelegt</Badge>}
                      {st === 'invalid' && <Badge tone="red">Datum fehlt</Badge>}
                      {errs.length > 0 && <Badge tone="red" className="ml-1">{errs.join(', ')}</Badge>}
                    </span>
                    <span className="text-sm text-stone-500">{d.rows.length} MA</span>
                    <Button size="sm" variant={i === active ? 'primary' : 'secondary'} onClick={() => setActive(i)}>{i === active ? 'Angezeigt' : 'Prüfen'}</Button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Vorschau des gewählten Tages */}
          <DayEditor
            day={day}
            locked={stateOf(day) === 'closed' || stateOf(day) === 'today-open'}
            knownKeys={knownKeys}
            dups={dupsOf(day)}
            rowErrors={rowErrors}
            onDate={(date) => updateDay(day.key, { date })}
            onRow={(rk, p) => updateRow(day.key, rk, p)}
            onRemoveRow={(rk) => updateDay(day.key, { rows: day.rows.filter((r) => r.key !== rk) })}
            onAddRow={() => updateDay(day.key, { rows: [...day.rows, { key: uid(), name: '', start: null, end: null }] })}
          />

          {result && result.lines.length > 0 && (
            <div>
              <button className="text-sm font-semibold text-stone-600 underline" onClick={() => setShowRaw(!showRaw)}>{showRaw ? 'Erkannten PDF-Text ausblenden' : 'Erkannten PDF-Text anzeigen'}</button>
              {showRaw && <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-stone-900 p-3 text-xs text-stone-100">{result.lines.join('\n')}</pre>}
            </div>
          )}

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 p-3">
            <div className="mx-auto flex max-w-4xl items-center justify-end gap-3">
              <span className="hidden text-sm text-stone-600 sm:block">{selected.length} Tag{selected.length === 1 ? '' : 'e'} ausgewählt</span>
              <Button variant="primary" size="lg" disabled={!valid} icon={<Wand2 />} onClick={start}>
                {selected.length > 1 ? `${selected.length} Tagespläne erstellen` : 'Tagesplan erstellen'} & Pausen planen
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={!!stale}
        onClose={() => setStale(null)}
        title="Ältere Tage noch nicht abgeschlossen"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStale(null)}>Abbrechen</Button>
            <Button onClick={() => { setStale(null); doCreate(); }}>Trotzdem fortfahren</Button>
            <Button variant="primary" icon={<Archive size={18} />} onClick={() => { stale?.forEach((p) => closePlan(p.id, 'manual')); toast('Ältere Tage abgeschlossen und archiviert', 'success'); setStale(null); doCreate(); }}>
              Jetzt abschließen & archivieren
            </Button>
          </>
        }
      >
        <p className="mb-2">Folgende vergangene Tagespläne sind noch offen und wurden nicht an die Personalleitung gesendet:</p>
        <ul className="list-inside list-disc font-semibold">{stale?.map((p) => <li key={p.id}>{fmtDate(p.plan_date)}</li>)}</ul>
        <p className="mt-3 text-sm text-stone-600">Der heutige Tag ist davon nicht betroffen.</p>
      </Modal>
    </div>
  );
}

function DayEditor({ day, locked, knownKeys, dups, rowErrors, onDate, onRow, onRemoveRow, onAddRow }: {
  day: EditDay; locked: boolean; knownKeys: Set<string>; dups: Map<string, number>; rowErrors: (r: EditRow) => string[];
  onDate: (d: string) => void; onRow: (rk: string, p: Partial<EditRow>) => void; onRemoveRow: (rk: string) => void; onAddRow: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-stone-50 px-4 py-2">
        <span className="text-sm font-semibold text-stone-600">Vorschau & Korrektur für</span>
        <input type="date" className={`${inputCls} !w-auto`} value={day.date} disabled={locked} onChange={(e) => onDate(e.target.value)} aria-label="Datum" />
        {locked && <span className="text-sm text-stone-500">Nur Ansicht – dieser Tag wird nicht verändert</span>}
      </div>
      <div className="divide-y divide-stone-100">
        {day.rows.map((r) => {
          const errs = rowErrors(r);
          const dup = (dups.get(nameKey(r.name)) ?? 0) > 1;
          const isNew = r.name.trim().length >= 2 && !knownKeys.has(nameKey(r.name));
          return (
            <div key={r.key} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${!locked && (errs.length || dup) ? 'bg-red-50/50' : ''}`}>
              <input disabled={locked} className={`${inputCls} min-w-40 flex-1`} value={r.name} placeholder="Name" onChange={(e) => onRow(r.key, { name: e.target.value })} aria-label="Name" />
              {locked ? (
                <span className="w-52 text-center tabular-nums">{r.start != null && `${Math.floor(r.start / 60).toString().padStart(2, '0')}:${(r.start % 60).toString().padStart(2, '0')}`} – {r.end != null && `${Math.floor(r.end / 60).toString().padStart(2, '0')}:${(r.end % 60).toString().padStart(2, '0')}`}</span>
              ) : (
                <>
                  <TimeInput value={r.start} onChange={(m) => onRow(r.key, { start: m })} aria-label="Beginn" />
                  <span>–</span>
                  <TimeInput value={r.end} onChange={(m) => onRow(r.key, { end: m })} aria-label="Ende" />
                </>
              )}
              <div className="flex w-36 flex-wrap gap-1">
                {isNew && <Badge tone="blue">Neu in Stammdaten</Badge>}
                {dup && <Badge tone="red">Doppelt</Badge>}
                {errs.map((e) => <Badge key={e} tone="red">{e}</Badge>)}
                {!errs.length && !dup && !isNew && <CheckCircle2 size={18} className="text-emerald-600" />}
              </div>
              {!locked && (
                <button aria-label="Zeile löschen" className="flex h-12 w-12 items-center justify-center rounded-xl text-stone-500 hover:bg-red-50 hover:text-red-700" onClick={() => onRemoveRow(r.key)}>
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          );
        })}
        {day.rows.length === 0 && <div className="p-4 text-center text-sm text-stone-500">Keine Mitarbeiter für diesen Tag.</div>}
      </div>
      {!locked && (
        <div className="border-t border-stone-200 p-3">
          <Button icon={<Plus size={18} />} onClick={onAddRow}>Zeile hinzufügen</Button>
        </div>
      )}
    </div>
  );
}
