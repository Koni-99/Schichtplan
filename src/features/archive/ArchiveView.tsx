import { useMemo, useState } from 'react';
import { Bell, ChevronDown, ChevronRight, FileDown, FileSpreadsheet, Folder, FolderOpen } from 'lucide-react';
import { useDB } from '../../store/db';
import { fmtDate, isoWeek, MONTHS_DE } from '../../lib/time';
import { exportCsv, exportPdf, type ReportDay } from '../../lib/export';
import { Badge, Button } from '../../components/ui';
import { buildTree, useClosedPlans, type WeekNode } from './useArchive';
import { ReportView } from './ReportView';
import { useAuth } from '../../store/auth';

export function ArchiveView() {
  const closed = useClosedPlans();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyDev, setOnlyDev] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isHr = useAuth((s) => s.role) === 'personalleitung';
  const unread = isHr ? closed.filter((p) => !p.is_read_by_hr) : [];
  const unreadDev = unread.filter((p) => p.has_deviations).length;

  const filtered = useMemo(() => closed.filter((p) => (!onlyUnread || !p.is_read_by_hr) && (!onlyDev || p.has_deviations)), [closed, onlyUnread, onlyDev]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const isOpen = (k: string, def: boolean) => open[k] ?? def;
  const toggle = (k: string, def: boolean) => setOpen((o) => ({ ...o, [k]: !(o[k] ?? def) }));
  const selPlan = selected ? closed.find((p) => p.id === selected) : undefined;

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 p-3 sm:p-4">
      {unread.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-brand-700 p-4 text-white shadow">
          <Bell className="shrink-0" />
          <div className="mr-auto">
            <div className="text-lg font-bold">{unread.length} neue{unread.length === 1 ? 'r' : ''} Tagesbericht{unread.length === 1 ? '' : 'e'}</div>
            <div className="text-sm text-white/80">{unreadDev > 0 ? `${unreadDev} davon mit Soll/Ist-Abweichungen – bitte in PEPZeit übertragen` : 'Keine Soll/Ist-Abweichungen'}</div>
          </div>
          <Button variant="secondary" onClick={() => setSelected(unread[unread.length - 1].id)}>Ältesten öffnen</Button>
          <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setOnlyUnread(!onlyUnread)}>{onlyUnread ? 'Alle zeigen' : 'Nur ungelesene'}</Button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
        <aside className={`space-y-2 ${selPlan ? 'hidden lg:block' : ''}`}>
          <div className="flex flex-wrap gap-2">
            {isHr && <Button size="sm" variant={onlyUnread ? 'primary' : 'secondary'} onClick={() => setOnlyUnread(!onlyUnread)}>Ungelesen</Button>}
            <Button size="sm" variant={onlyDev ? 'primary' : 'secondary'} onClick={() => setOnlyDev(!onlyDev)}>Mit Abweichungen</Button>
          </div>
          <div className="rounded-2xl bg-white p-2 ring-1 ring-stone-200">
            {tree.length === 0 && <p className="p-4 text-center text-stone-500">Keine abgeschlossenen Tagespläne.</p>}
            {tree.map((y, yi) => (
              <div key={y.year}>
                <TreeBtn level={0} open={isOpen(`y${y.year}`, yi === 0)} onClick={() => toggle(`y${y.year}`, yi === 0)} label={String(y.year)} count={y.months.flatMap((m) => m.weeks.flatMap((w) => w.days)).filter((d) => isHr && !d.is_read_by_hr).length} />
                {isOpen(`y${y.year}`, yi === 0) &&
                  y.months.map((m, mi) => {
                    const mdef = yi === 0 && mi === 0;
                    return (
                      <div key={m.key}>
                        <TreeBtn level={1} open={isOpen(m.key, mdef)} onClick={() => toggle(m.key, mdef)} label={MONTHS_DE[m.month - 1]} count={m.weeks.flatMap((w) => w.days).filter((d) => isHr && !d.is_read_by_hr).length} />
                        {isOpen(m.key, mdef) &&
                          m.weeks.map((w) => (
                            <div key={w.key}>
                              <WeekRow w={w} open={isOpen(w.key, mdef)} onToggle={() => toggle(w.key, mdef)} />
                              {isOpen(w.key, mdef) &&
                                w.days.map((d) => (
                                  <button
                                    key={d.id}
                                    onClick={() => setSelected(d.id)}
                                    className={`flex min-h-12 w-full items-center gap-2 rounded-lg pl-16 pr-2 text-left ${selected === d.id ? 'bg-brand-100' : 'hover:bg-stone-50'}`}
                                  >
                                    {isHr && !d.is_read_by_hr && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" aria-label="ungelesen" />}
                                    <span className={`flex-1 ${isHr && !d.is_read_by_hr ? 'font-bold' : ''}`}>{fmtDate(d.plan_date, { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
                                    {d.has_deviations && <Badge tone="amber">Abw.</Badge>}
                                    {d.closed_type === 'auto' && <Badge tone="stone">Auto</Badge>}
                                    {d.hr_processed && <Badge tone="green">✓</Badge>}
                                  </button>
                                ))}
                            </div>
                          ))}
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </aside>
        <section className={selPlan ? '' : 'hidden lg:block'}>
          {selPlan ? <ReportView key={selPlan.id} plan={selPlan} onBack={() => setSelected(null)} /> : <div className="rounded-2xl bg-white p-10 text-center text-stone-500 ring-1 ring-stone-200">Tagesbericht im Archiv auswählen.</div>}
        </section>
      </div>
    </div>
  );
}

function TreeBtn({ level, open, onClick, label, count }: { level: number; open: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick} className="flex min-h-12 w-full items-center gap-2 rounded-lg px-2 text-left font-semibold hover:bg-stone-50" style={{ paddingLeft: 8 + level * 20 }}>
      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      {open ? <FolderOpen size={18} className="text-amber-600" /> : <Folder size={18} className="text-amber-600" />}
      <span className="flex-1">{label}</span>
      {count > 0 && <span className="rounded-full bg-red-600 px-2 text-xs text-white">{count}</span>}
    </button>
  );
}

function weekDays(w: WeekNode): ReportDay[] {
  const s = useDB.getState();
  // ganze ISO-KW (auch Tage aus dem Nachbarmonat)
  return Object.values(s.plans)
    .filter((p) => !p.deleted_at && p.status === 'closed' && isoWeek(p.plan_date).week === w.week && isoWeek(p.plan_date).year === w.weekYear)
    .map((plan) => ({
      plan,
      shifts: Object.values(s.shifts).filter((x) => x.plan_id === plan.id && !x.deleted_at),
      pauses: Object.values(s.pauses).filter((x) => x.plan_id === plan.id && !x.deleted_at),
    }));
}

function WeekRow({ w, open, onToggle }: { w: WeekNode; open: boolean; onToggle: () => void }) {
  const isHr = useAuth((s) => s.role) === 'personalleitung';
  const unread = isHr ? w.days.filter((d) => !d.is_read_by_hr).length : 0;
  return (
    <div className="flex items-center gap-1">
      <button onClick={onToggle} className="flex min-h-12 flex-1 items-center gap-2 rounded-lg pl-12 pr-2 text-left font-semibold hover:bg-stone-50">
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="flex-1">KW {w.week}</span>
        {unread > 0 && <span className="rounded-full bg-red-600 px-2 text-xs text-white">{unread}</span>}
      </button>
      <button title="KW als CSV/Excel exportieren" aria-label={`KW ${w.week} als CSV exportieren`} className="flex h-12 w-10 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100" onClick={() => exportCsv(weekDays(w), useDB.getState().settings, `Pausen_KW${w.week}_${w.weekYear}.csv`)}>
        <FileSpreadsheet size={18} />
      </button>
      <button title="KW als PDF exportieren" aria-label={`KW ${w.week} als PDF exportieren`} className="flex h-12 w-10 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100" onClick={() => void exportPdf(weekDays(w), useDB.getState().settings, `Pausennachweis KW ${w.week}/${w.weekYear}`, `Pausen_KW${w.week}_${w.weekYear}.pdf`)}>
        <FileDown size={18} />
      </button>
    </div>
  );
}
