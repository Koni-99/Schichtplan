import { useMemo, useState } from 'react';
import { Coffee, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useDB } from '../../store/db';
import { deleteEmployee, findEmployeeByName, newEmployee, saveEmployee } from '../../store/actions';
import type { Employee, PauseModel } from '../../lib/types';
import { PAUSE_MODEL_LABEL } from '../../lib/types';
import { fmtMin } from '../../lib/time';
import { Badge, Button, Field, inputCls, Modal, TimeInput, toast } from '../../components/ui';

export function profileSummary(e: Employee, defCount: number, defMin: number): string {
  switch (e.pause_model) {
    case 'standard': return `${defCount} × ${defMin} Min. flexibel`;
    case 'flexible_custom': return `${e.custom_block_count} × ${e.custom_block_minutes} Min. flexibel`;
    case 'fixed': return e.fixed_starts.length ? `${e.fixed_starts.map(fmtMin).join(' & ')} (je ${e.fixed_block_minutes} Min.)` : 'Feste Zeiten – noch keine hinterlegt';
    case 'none': return 'Keine Pause';
  }
}

export function EmployeesView() {
  const employeesAll = useDB((s) => s.employees);
  const settings = useDB((s) => s.settings);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Employee | null>(null);
  const list = useMemo(
    () => Object.values(employeesAll).filter((e) => !e.deleted_at && e.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'de')),
    [employeesAll, q],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Mitarbeiter & Pausenprofile</h1>
        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEdit(newEmployee(''))}>Mitarbeiter</Button>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-3.5 text-stone-400" size={20} />
        <input className={`${inputCls} pl-10`} placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="text-sm text-stone-500">Neue Mitarbeiter werden beim PDF-Import automatisch angelegt. Profiländerungen wirken beim nächsten Klick auf „Pausen automatisch planen“.</p>
      <div className="divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
        {list.length === 0 && <div className="p-6 text-center text-stone-500">Noch keine Mitarbeiter – importieren Sie einen PEPZeit-Plan.</div>}
        {list.map((e) => (
          <button key={e.id} onClick={() => setEdit(e)} className={`flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left hover:bg-stone-50 ${!e.active ? 'opacity-50' : ''}`}>
            <Coffee size={20} className={e.pause_model === 'none' ? 'text-stone-300' : e.pause_model === 'fixed' ? 'text-violet-600' : e.pause_model === 'flexible_custom' ? 'text-amber-600' : 'text-sky-600'} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{e.name}</div>
              <div className="text-sm text-stone-500">{profileSummary(e, settings.default_block_count, settings.default_block_minutes)}</div>
            </div>
            <Badge tone={e.pause_model === 'standard' ? 'blue' : e.pause_model === 'fixed' ? 'violet' : e.pause_model === 'none' ? 'stone' : 'amber'}>{PAUSE_MODEL_LABEL[e.pause_model].split(' (')[0]}</Badge>
            {!e.active && <Badge>inaktiv</Badge>}
            <Pencil size={16} className="text-stone-400" />
          </button>
        ))}
      </div>
      {edit && <EmployeeEditor initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EmployeeEditor({ initial, onClose }: { initial: Employee; onClose: () => void }) {
  const [e, setE] = useState<Employee>(initial);
  const isNew = !useDB.getState().employees[initial.id];
  const set = (p: Partial<Employee>) => setE((x) => ({ ...x, ...p }));
  const models: PauseModel[] = ['standard', 'flexible_custom', 'fixed', 'none'];

  const save = () => {
    if (e.name.trim().length < 2) return toast('Bitte einen Namen eingeben', 'error');
    const dup = findEmployeeByName(e.name);
    if (dup && dup.id !== e.id) return toast('Ein Mitarbeiter mit diesem Namen existiert bereits', 'error');
    if (e.pause_model === 'fixed' && e.fixed_starts.length === 0) return toast('Bitte mindestens eine feste Pausen-Uhrzeit angeben', 'error');
    saveEmployee({ ...e, fixed_starts: [...e.fixed_starts].sort((a, b) => a - b) });
    toast('Gespeichert', 'success');
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Neuer Mitarbeiter' : e.name}
      footer={
        <>
          {!isNew && (
            <Button variant="ghost" className="mr-auto text-red-700" icon={<Trash2 size={18} />} onClick={() => { if (window.confirm(`${e.name} aus den Stammdaten löschen? Bestehende Tagespläne bleiben erhalten.`)) { deleteEmployee(e.id); onClose(); } }}>
              Löschen
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>Speichern</Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name (wie im PEPZeit-Plan)">
          <input className={inputCls} value={e.name} onChange={(x) => set({ name: x.target.value })} autoFocus={isNew} />
        </Field>
        <div>
          <div className="mb-2 text-sm font-semibold text-stone-700">Pausenprofil</div>
          <div className="grid gap-2">
            {models.map((m) => (
              <label key={m} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 px-3 ${e.pause_model === m ? 'border-brand-700 bg-brand-50' : 'border-stone-200'}`}>
                <input type="radio" className="h-5 w-5" checked={e.pause_model === m} onChange={() => set({ pause_model: m })} />
                <span className="font-semibold">{PAUSE_MODEL_LABEL[m]}</span>
              </label>
            ))}
          </div>
        </div>
        {e.pause_model === 'flexible_custom' && (
          <div className="space-y-3 rounded-xl bg-amber-50 p-3">
            <div className="flex flex-wrap gap-2">
              {[[2, 15], [1, 30], [2, 20], [3, 15]].map(([c, m]) => (
                <Button key={`${c}x${m}`} size="sm" variant={e.custom_block_count === c && e.custom_block_minutes === m ? 'primary' : 'secondary'} onClick={() => set({ custom_block_count: c, custom_block_minutes: m })}>
                  {c} × {m} Min.
                </Button>
              ))}
            </div>
            <div className="flex items-end gap-3">
              <Field label="Anzahl Blöcke"><input type="number" min={1} max={4} className={`${inputCls} !w-24`} value={e.custom_block_count} onChange={(x) => set({ custom_block_count: Math.max(1, Math.min(4, +x.target.value)) })} /></Field>
              <Field label="Minuten je Block"><input type="number" min={5} max={60} step={5} className={`${inputCls} !w-28`} value={e.custom_block_minutes} onChange={(x) => set({ custom_block_minutes: Math.max(5, +x.target.value) })} /></Field>
            </div>
          </div>
        )}
        {e.pause_model === 'fixed' && (
          <div className="space-y-3 rounded-xl bg-violet-50 p-3">
            {e.fixed_starts.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-20 font-semibold">Block {i + 1}</span>
                <TimeInput value={t} onChange={(m) => m != null && set({ fixed_starts: e.fixed_starts.map((x, j) => (j === i ? m : x)) })} />
                <button aria-label="Entfernen" className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-violet-100" onClick={() => set({ fixed_starts: e.fixed_starts.filter((_, j) => j !== i) })}><Trash2 size={18} /></button>
              </div>
            ))}
            {e.fixed_starts.length < 4 && <Button size="sm" icon={<Plus size={16} />} onClick={() => set({ fixed_starts: [...e.fixed_starts, e.fixed_starts.length ? Math.min(e.fixed_starts[e.fixed_starts.length - 1] + 210, 1200) : 600] })}>Uhrzeit hinzufügen</Button>}
            <Field label="Dauer je Block (Min.)"><input type="number" min={5} max={60} step={5} className={`${inputCls} !w-28`} value={e.fixed_block_minutes} onChange={(x) => set({ fixed_block_minutes: Math.max(5, +x.target.value) })} /></Field>
          </div>
        )}
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" className="h-6 w-6" checked={e.active} onChange={(x) => set({ active: x.target.checked })} />
          Aktiv (in Vorschlagslisten anzeigen)
        </label>
      </div>
    </Modal>
  );
}
