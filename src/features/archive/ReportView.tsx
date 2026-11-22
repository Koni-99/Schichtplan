import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileDown, FileSpreadsheet, StickyNote, UserPlus } from 'lucide-react';
import { useDB } from '../../store/db';
import { markHrRead, setHrProcessed } from '../../store/actions';
import type { DailyPlan } from '../../lib/types';
import { SHIFT_STATUS_LABEL } from '../../lib/types';
import { diffPlan, DEVIATION_LABEL, type ShiftDiff } from '../../lib/diff';
import { fmtDate, fmtMin, isoWeek } from '../../lib/time';
import { exportCsv, exportPdf } from '../../lib/export';
import { Badge, Button } from '../../components/ui';

/** Soll/Ist-Diff-Ansicht für die Übertragung in PEPZeit. */
export function ReportView({ plan, onBack }: { plan: DailyPlan; onBack: () => void }) {
  const shiftsAll = useDB((s) => s.shifts);
  const pausesAll = useDB((s) => s.pauses);
  const settings = useDB((s) => s.settings);
  const [onlyDev, setOnlyDev] = useState(false);
  const shifts = useMemo(() => Object.values(shiftsAll).filter((x) => x.plan_id === plan.id && !x.deleted_at), [shiftsAll, plan.id]);
  const pauses = useMemo(() => Object.values(pausesAll).filter((x) => x.plan_id === plan.id && !x.deleted_at), [pausesAll, plan.id]);
  const diffs = useMemo(() => diffPlan(plan, shifts, pauses, settings), [plan, shifts, pauses, settings]);
  const devs = diffs.filter((d) => d.kinds.length);

  // Beim Öffnen gilt der Bericht als gelesen
  useEffect(() => {
    if (!plan.is_read_by_hr) markHrRead(plan.id);
  }, [plan.id, plan.is_read_by_hr]);

  const day = [{ plan, shifts, pauses }];
  const base = `Pausen_${plan.plan_date}`;
  const totals = diffs.reduce((a, d) => ({ sollPause: a.sollPause + d.sollPause, istPause: a.istPause + d.istPause, sollWork: a.sollWork + d.sollWork, istWork: a.istWork + d.istWork }), { sollPause: 0, istPause: 0, sollWork: 0, istWork: 0 });
  const list = onlyDev ? devs : diffs;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <Button variant="ghost" className="lg:hidden" icon={<ArrowLeft size={18} />} onClick={onBack}>Archiv</Button>
        <div className="mr-auto">
          <h2 className="text-xl font-bold">{fmtDate(plan.plan_date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</h2>
          <div className="text-sm text-stone-500">
            KW {isoWeek(plan.plan_date).week} · {plan.closed_label ?? (plan.closed_type === 'auto' ? 'Automatisch abgeschlossen' : 'Manuell abgeschlossen')}
            {plan.closed_at && ` · ${new Date(plan.closed_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`}
          </div>
        </div>
        <Button icon={<FileSpreadsheet size={18} />} onClick={() => exportCsv(day, settings, `${base}.csv`)}>CSV / Excel</Button>
        <Button icon={<FileDown size={18} />} onClick={() => void exportPdf(day, settings, 'Pausennachweis Filiale', `${base}.pdf`)}>PDF</Button>
        <Button variant={plan.hr_processed ? 'success' : 'primary'} icon={<CheckCircle2 size={18} />} onClick={() => setHrProcessed(plan.id, !plan.hr_processed)}>
          {plan.hr_processed ? 'Bearbeitet' : 'Als bearbeitet markieren'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Mitarbeiter" value={String(diffs.length)} />
        <Stat label="Mit Abweichungen" value={String(devs.length)} tone={devs.length ? 'amber' : 'green'} />
        <Stat label="Pause Soll / Ist" value={`${totals.sollPause} / ${totals.istPause} Min.`} tone={totals.sollPause !== totals.istPause ? 'amber' : undefined} />
        <Stat label="Arbeitszeit Soll / Ist" value={`${(totals.sollWork / 60).toFixed(1)} / ${(totals.istWork / 60).toFixed(1)} Std.`} />
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant={onlyDev ? 'primary' : 'secondary'} onClick={() => setOnlyDev(!onlyDev)}>Nur Abweichungen</Button>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-stone-200">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2">Mitarbeiter</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Arbeitszeit Soll → Ist</th>
              <th className="px-3 py-2">Pause Soll → Ist</th>
              <th className="px-3 py-2">Pausenblöcke</th>
              <th className="px-3 py-2">Abweichungen / Notiz</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {list.map((d) => <DiffRow key={d.shift.id} d={d} />)}
            {list.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-stone-500">Keine Abweichungen – alles nach Plan.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'green' }) {
  return (
    <div className={`rounded-2xl p-3 ring-1 ${tone === 'amber' ? 'bg-amber-50 ring-amber-200' : tone === 'green' ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-stone-200'}`}>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function DiffRow({ d }: { d: ShiftDiff }) {
  const s = d.shift;
  const timeDev = d.kinds.includes('time');
  const pauseDev = d.kinds.includes('pause');
  const removed = d.kinds.includes('removed');
  const sick = d.kinds.includes('sick') || d.kinds.includes('absent') || removed;
  return (
    <tr className={removed ? 'bg-stone-100' : sick ? 'bg-red-50' : d.kinds.length ? 'bg-amber-50/60' : ''}>
      <td className="px-3 py-2 font-semibold">
        <span className="flex items-center gap-1">
          {s.is_manual && <UserPlus size={14} className="text-violet-600" />}
          {s.employee_name}
        </span>
      </td>
      <td className="px-3 py-2">
        <Badge tone={s.status === 'present' ? 'green' : removed ? 'stone' : sick ? 'red' : 'amber'}>{SHIFT_STATUS_LABEL[s.status]}</Badge>
      </td>
      <td className="px-3 py-2 tabular-nums">
        <span className="text-stone-500">{d.sollStart != null ? `${fmtMin(d.sollStart)}–${fmtMin(d.sollEnd)}` : 'ohne Soll'}</span>
        {' → '}
        <span className={timeDev || sick ? 'font-bold text-red-700' : ''}>{d.istStart != null ? `${fmtMin(d.istStart)}–${fmtMin(d.istEnd)}` : '–'}</span>
      </td>
      <td className="px-3 py-2 tabular-nums">
        <span className="text-stone-500">{d.sollPause}</span> → <span className={pauseDev ? 'font-bold text-red-700' : ''}>{d.istPause} Min.</span>
      </td>
      <td className="px-3 py-2 text-xs text-stone-600">
        {d.blocks.filter((b) => b.status !== 'cancelled').map((b) => (
          <div key={b.id} className="tabular-nums">
            B{b.block_no} {fmtMin(b.start_min)} · {b.status === 'done' ? `${b.actual_duration_min ?? b.planned_duration_min}/${b.planned_duration_min} Min.` : 'nicht genommen'}
          </div>
        ))}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {d.kinds.filter((k) => k !== 'note').map((k) => <Badge key={k} tone={k === 'sick' || k === 'absent' || k === 'arbzg' ? 'red' : k === 'removed' ? 'stone' : k === 'manual' ? 'violet' : 'amber'}>{DEVIATION_LABEL[k]}</Badge>)}
        </div>
        {removed && (
          <div className="mt-1 text-stone-700">
            <b>Grund:</b> {s.removed_reason || '–'}
            <span className="block text-xs text-stone-500">
              {[s.removed_by_name, s.removed_at && new Date(s.removed_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
        {s.note && <div className="mt-1 flex items-start gap-1 text-stone-700"><StickyNote size={14} className="mt-0.5 shrink-0" />{s.note}</div>}
      </td>
    </tr>
  );
}
