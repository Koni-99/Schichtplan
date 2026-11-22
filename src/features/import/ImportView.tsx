import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, FileText, FileUp, Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { parsePepzeitPdf, type ParseResult } from '../../lib/pdfParser';
import { fmtDate, nameKey, todayISO, uid } from '../../lib/time';
import { useDB } from '../../store/db';
import { closePlan, createPlanFromImport, planByDate } from '../../store/actions';
import { Badge, Button, Modal, TimeInput, inputCls, toast } from '../../components/ui';
import type { DailyPlan } from '../../lib/types';

interface EditRow { key: string; name: string; start: number | null; end: number | null }

export function ImportView({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [pendingPrev, setPendingPrev] = useState<DailyPlan[] | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const employees = useDB((s) => s.employees);
  const plans = useDB((s) => s.plans);
  const knownKeys = useMemo(() => new Set(Object.values(employees).filter((e) => !e.deleted_at).map((e) => e.name_key)), [employees]);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const r = await parsePepzeitPdf(file);
      setResult(r);
      setFilename(file.name);
      if (r.date) setDate(r.date);
      setRows(r.shifts.map((s) => ({ key: uid(), name: s.name, start: s.start, end: s.end })));
    } catch (e) {
      console.error(e);
      toast('PDF konnte nicht gelesen werden. Bitte Zeiten manuell erfassen.', 'error');
      setResult({ date: null, shifts: [], lines: [], warnings: ['PDF konnte nicht gelesen werden.'] });
      setRows([{ key: uid(), name: '', start: null, end: null }]);
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
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    rows?.forEach((r) => seen.set(nameKey(r.name), (seen.get(nameKey(r.name)) ?? 0) + 1));
    return seen;
  }, [rows]);
  const valid = !!rows && rows.length > 0 && rows.every((r) => rowErrors(r).length === 0) && [...duplicates.values()].every((n) => n === 1) && /^\d{4}-\d{2}-\d{2}$/.test(date);

  const doCreate = (replace: boolean) => {
    try {
      createPlanFromImport(date, rows!.map((r) => ({ name: r.name.trim(), start: r.start!, end: r.end! })), filename, replace);
      toast(`Tagesplan für ${fmtDate(date)} erstellt – Pausen wurden automatisch verteilt.`, 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  /** Prüfschritte vor dem Anlegen: offener Vortag → bestehender Plan → anlegen. */
  const start = () => {
    const prev = Object.values(plans).filter((p) => !p.deleted_at && p.status === 'open' && p.plan_date < date);
    if (prev.length) return setPendingPrev(prev);
    proceedAfterPrev();
  };
  const proceedAfterPrev = () => {
    setPendingPrev(null);
    const existing = planByDate(date);
    if (existing?.status === 'closed') return toast(`Der ${fmtDate(date)} ist bereits abgeschlossen und archiviert – ein erneuter Import ist nicht möglich.`, 'error');
    if (existing) return setConfirmReplace(true);
    doCreate(false);
  };

  const update = (key: string, patch: Partial<EditRow>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-6">
      <h1 className="text-2xl font-bold">PEPZeit-Schichtplan importieren</h1>

      {!rows && (
        <div className="space-y-3">
          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}
            className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-brand-500/50 bg-white p-10 text-center hover:bg-brand-50"
          >
            {busy ? <Loader2 size={48} className="animate-spin text-brand-700" /> : <FileUp size={48} className="text-brand-700" />}
            <span className="text-xl font-bold">{busy ? 'PDF wird ausgelesen …' : 'PDF auswählen oder hierher ziehen'}</span>
            <span className="text-stone-500">Täglicher PEPZeit-Schichtplan · Datum, Namen und Schichtzeiten werden automatisch erkannt</span>
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
          <Button
            icon={<FileText size={18} />}
            disabled={busy}
            onClick={async () => {
              const res = await fetch(`${import.meta.env.BASE_URL}pepzeit-beispiel.pdf`);
              const blob = await res.blob();
              void onFile(new File([blob], 'pepzeit-beispiel.pdf', { type: 'application/pdf' }));
            }}
          >
            Beispiel-PDF ausprobieren
          </Button>
          <Button variant="ghost" icon={<Plus size={18} />} onClick={() => { setResult(null); setFilename(null); setRows([{ key: uid(), name: '', start: null, end: null }]); }}>
            Ohne PDF manuell erfassen
          </Button>
        </div>
      )}

      {rows && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
            <label>
              <span className="mb-1 block text-sm font-semibold">Datum des Plans</span>
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="text-sm text-stone-600">
              {filename && <div className="flex items-center gap-1"><FileText size={14} /> {filename}</div>}
              <div>{rows.length} Mitarbeiter erkannt{result?.date ? '' : ' · Datum nicht erkannt, bitte prüfen'}</div>
            </div>
            <Button variant="ghost" className="ml-auto" onClick={() => { setRows(null); setResult(null); }}>Andere Datei</Button>
          </div>

          {result?.warnings.map((w) => (
            <div key={w} className="flex items-center gap-2 rounded-xl bg-orange-50 p-3 text-sm text-orange-900"><AlertTriangle size={16} />{w}</div>
          ))}

          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
            <div className="border-b border-stone-200 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600">Vorschau & Korrektur – Lesefehler hier direkt berichtigen</div>
            <div className="divide-y divide-stone-100">
              {rows.map((r) => {
                const errs = rowErrors(r);
                const dup = (duplicates.get(nameKey(r.name)) ?? 0) > 1;
                const isNew = r.name.trim().length >= 2 && !knownKeys.has(nameKey(r.name));
                return (
                  <div key={r.key} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${errs.length || dup ? 'bg-red-50/50' : ''}`}>
                    <input className={`${inputCls} min-w-40 flex-1`} value={r.name} placeholder="Name" onChange={(e) => update(r.key, { name: e.target.value })} aria-label="Name" />
                    <TimeInput value={r.start} onChange={(m) => update(r.key, { start: m })} aria-label="Beginn" />
                    <span>–</span>
                    <TimeInput value={r.end} onChange={(m) => update(r.key, { end: m })} aria-label="Ende" />
                    <div className="flex w-36 flex-wrap gap-1">
                      {isNew && <Badge tone="blue">Neu in Stammdaten</Badge>}
                      {dup && <Badge tone="red">Doppelt</Badge>}
                      {errs.map((e) => <Badge key={e} tone="red">{e}</Badge>)}
                      {!errs.length && !dup && !isNew && <CheckCircle2 size={18} className="text-emerald-600" />}
                    </div>
                    <button aria-label="Zeile löschen" className="flex h-12 w-12 items-center justify-center rounded-xl text-stone-500 hover:bg-red-50 hover:text-red-700" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-stone-200 p-3">
              <Button icon={<Plus size={18} />} onClick={() => setRows([...rows, { key: uid(), name: '', start: null, end: null }])}>Zeile hinzufügen</Button>
            </div>
          </div>

          {result && result.lines.length > 0 && (
            <div>
              <button className="text-sm font-semibold text-stone-600 underline" onClick={() => setShowRaw(!showRaw)}>{showRaw ? 'Erkannten PDF-Text ausblenden' : 'Erkannten PDF-Text anzeigen'}</button>
              {showRaw && <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-stone-900 p-3 text-xs text-stone-100">{result.lines.join('\n')}</pre>}
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="primary" size="lg" disabled={!valid} icon={<Wand2 />} onClick={start}>
              Tagesplan erstellen & Pausen planen
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={!!pendingPrev}
        onClose={() => setPendingPrev(null)}
        title="Vortag noch nicht abgeschlossen"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingPrev(null)}>Abbrechen</Button>
            <Button onClick={proceedAfterPrev}>Trotzdem fortfahren</Button>
            <Button variant="primary" icon={<Archive size={18} />} onClick={() => { pendingPrev?.forEach((p) => closePlan(p.id, 'manual')); toast('Vortag abgeschlossen und archiviert', 'success'); proceedAfterPrev(); }}>
              Jetzt abschließen & archivieren
            </Button>
          </>
        }
      >
        <p className="mb-2">Folgende Tagespläne sind noch offen und wurden nicht an die Personalleitung gesendet:</p>
        <ul className="list-inside list-disc font-semibold">{pendingPrev?.map((p) => <li key={p.id}>{fmtDate(p.plan_date)}</li>)}</ul>
        <p className="mt-3 text-sm text-stone-600">Um Datenverlust zu vermeiden, empfehlen wir, den Vortag jetzt abzuschließen.</p>
      </Modal>

      <Modal
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        title="Plan existiert bereits"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReplace(false)}>Abbrechen</Button>
            <Button variant="danger" onClick={() => { setConfirmReplace(false); doCreate(true); }}>Ersetzen</Button>
          </>
        }
      >
        Für den {fmtDate(date)} gibt es bereits einen Tagesplan. Soll er durch den neuen Import ersetzt werden? Alle Änderungen des bestehenden Plans gehen dabei verloren.
      </Modal>
    </div>
  );
}
