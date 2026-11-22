import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useDB } from '../../store/db';
import { saveSettings } from '../../store/actions';
import type { Settings } from '../../lib/types';
import { Button, Field, inputCls, TimeInput, toast } from '../../components/ui';
import { isCloudMode } from '../../lib/supabase';

export function SettingsView() {
  const settings = useDB((s) => s.settings);
  const [f, setF] = useState<Settings>(settings);
  useEffect(() => setF(settings), [settings]);
  const set = (p: Partial<Settings>) => setF((x) => ({ ...x, ...p }));
  const num = (k: keyof Settings, min = 0, max = 600) => ({
    type: 'number' as const,
    className: `${inputCls} !w-28`,
    value: f[k] as number,
    min,
    max,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: Math.max(min, Math.min(max, Number(e.target.value))) } as Partial<Settings>),
  });
  const hours = (k: keyof Settings) => ({
    type: 'number' as const,
    step: 0.25,
    min: 0,
    max: 8,
    className: `${inputCls} !w-28`,
    value: (f[k] as number) / 60,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: Math.round(Number(e.target.value) * 60) } as Partial<Settings>),
  });
  const dirty = JSON.stringify({ ...f, updated_at: '' }) !== JSON.stringify({ ...settings, updated_at: '' });

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-3 pb-24 sm:p-6">
      <h1 className="text-2xl font-bold">Einstellungen</h1>

      <section className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <h2 className="text-lg font-bold">Tagesabschluss</h2>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" className="h-6 w-6" checked={f.auto_close_enabled} onChange={(e) => set({ auto_close_enabled: e.target.checked })} />
          Tag automatisch abschließen, falls nicht manuell erfolgt
        </label>
        <Field label="Uhrzeit Auto-Abschluss & Export an Personalleitung" hint={isCloudMode ? 'Wird serverseitig per pg_cron alle 5 Minuten geprüft (Europe/Berlin).' : 'Lokaler Modus: Abschluss erfolgt, sobald die App zu dieser Zeit geöffnet ist.'}>
          <TimeInput value={f.auto_close_time} onChange={(m) => m != null && set({ auto_close_time: m })} />
        </Field>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" className="h-6 w-6" checked={f.count_unstarted_as_taken} onChange={(e) => set({ count_unstarted_as_taken: e.target.checked })} />
          Nicht gestartete Pausen beim Abschluss als planmäßig genommen werten
        </label>
      </section>

      <section className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <h2 className="text-lg font-bold">Kapazität</h2>
        <Field label="Maximal gleichzeitig in Pause"><input {...num('max_concurrent_pauses', 1, 20)} /></Field>
      </section>

      <section className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <h2 className="text-lg font-bold">Pausenabstände (Stunden)</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Block 1 frühestens nach Schichtbeginn"><input {...hours('min_after_start_min')} /></Field>
          <Field label="Mindestabstand zwischen Blöcken"><input {...hours('min_between_blocks_min')} /></Field>
          <Field label="Letzter Block spätestens vor Schichtende"><input {...hours('min_before_end_min')} /></Field>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <h2 className="text-lg font-bold">Standard-Pausenmodell</h2>
        <div className="flex flex-wrap gap-4">
          <Field label="Blöcke (reguläre Schicht)"><input {...num('default_block_count', 0, 4)} /></Field>
          <Field label="Minuten je Block"><input {...num('default_block_minutes', 5, 60)} /></Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <Field label="Kurzschicht unter (Stunden)"><input {...hours('short_shift_threshold_min')} /></Field>
          <Field label="Blöcke bei Kurzschicht"><input {...num('short_shift_block_count', 0, 4)} /></Field>
          <Field label="Minuten je Block (Kurzschicht)"><input {...num('short_shift_block_minutes', 5, 60)} /></Field>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 p-3">
        <div className="mx-auto flex max-w-3xl justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setF(settings)}>Verwerfen</Button>
          <Button variant="primary" disabled={!dirty} icon={<Save size={18} />} onClick={() => { saveSettings(f); toast('Einstellungen gespeichert', 'success'); }}>Speichern</Button>
        </div>
      </div>
    </div>
  );
}
