import { useEffect, useState } from 'react';
import { ImagePlus, Save, Trash2 } from 'lucide-react';
import { ACCENT_PRESETS, BRAND_PRESETS, logoToDataUrl } from '../../lib/branding';
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
        <h2 className="text-lg font-bold">Darstellung</h2>
        <p className="text-sm text-stone-600">Gilt für alle Geräte. Die Schriftgröße stellt jedes Gerät oben rechts selbst ein.</p>
        <Field label="Name der Bäckerei / Filiale" hint="Erscheint oben in der App und auf dem Anmeldebildschirm.">
          <input id="brand-name" className={inputCls} placeholder="z. B. Bäckerei Sonnenkorn – Filiale Hauptstraße" value={f.brand_name ?? ''} maxLength={60} onChange={(e) => set({ brand_name: e.target.value })} />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-semibold text-stone-700">Logo</span>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-stone-50 ring-1 ring-stone-200">
              {f.brand_logo ? <img src={f.brand_logo} alt="Logo" className="max-h-16 max-w-16 object-contain" /> : <span className="text-xs text-stone-400">kein Logo</span>}
            </div>
            <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 font-semibold hover:bg-stone-100">
              <ImagePlus size={18} /> Logo hochladen
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try { set({ brand_logo: await logoToDataUrl(file) }); } catch (err) { toast((err as Error).message, 'error'); }
                }}
              />
            </label>
            {f.brand_logo && <Button variant="ghost" icon={<Trash2 size={18} />} onClick={() => set({ brand_logo: null })}>Entfernen</Button>}
          </div>
          <span className="mt-1 block text-xs text-stone-500">PNG, JPG oder SVG. Am besten quadratisch, möglichst mit transparentem Hintergrund.</span>
        </div>
        <div>
          <span className="mb-1 block text-sm font-semibold text-stone-700">Firmenfarbe</span>
          <div className="flex flex-wrap items-center gap-2">
            {BRAND_PRESETS.map((p) => (
              <button
                key={p.color}
                onClick={() => set({ brand_color: p.color })}
                className={`flex min-h-12 items-center gap-2 rounded-xl border-2 bg-white px-3 text-sm font-semibold ${f.brand_color?.toLowerCase() === p.color ? 'border-stone-800' : 'border-stone-200'}`}
              >
                <span className="h-6 w-6 rounded-full" style={{ background: p.color }} />
                {p.name}
              </button>
            ))}
            <label className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-stone-200 bg-white px-3 text-sm font-semibold">
              <input type="color" className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" value={f.brand_color ?? '#8a3b12'} onChange={(e) => set({ brand_color: e.target.value })} aria-label="Eigene Farbe wählen" />
              Eigene Farbe
            </label>
          </div>
          <span className="mt-1 block text-xs text-stone-500">Für Knöpfe und Überschriften. Tipp: eine eher dunkle Farbe wählen, damit weiße Schrift gut lesbar bleibt.</span>
        </div>
        <div>
          <span className="mb-1 block text-sm font-semibold text-stone-700">Akzentfarbe</span>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.color}
                onClick={() => set({ brand_accent: p.color })}
                className={`flex min-h-12 items-center gap-2 rounded-xl border-2 bg-white px-3 text-sm font-semibold ${f.brand_accent?.toLowerCase() === p.color ? 'border-stone-800' : 'border-stone-200'}`}
              >
                <span className="h-6 w-6 rounded-full" style={{ background: p.color }} />
                {p.name}
              </button>
            ))}
            <label className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-stone-200 bg-white px-3 text-sm font-semibold">
              <input type="color" className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" value={f.brand_accent ?? '#e8a90c'} onChange={(e) => set({ brand_accent: e.target.value })} aria-label="Eigene Akzentfarbe wählen" />
              Eigene Farbe
            </label>
          </div>
          <span className="mt-1 block text-xs text-stone-500">Für Markierungen: Leiste oben, aktiver Reiter, „heute“. Eine helle, kräftige Farbe passt am besten.</span>
        </div>
        <div className="rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Vorschau</div>
          <div className="flex flex-wrap items-center gap-3 border-t-4 border-accent-500 pt-3" style={{ ['--brand' as string]: f.brand_color ?? '#6b4226', ['--accent' as string]: f.brand_accent ?? '#e8a90c' }}>
            {f.brand_logo ? <img src={f.brand_logo} alt="" className="h-10 w-10 rounded-lg object-contain" /> : <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-10 w-10" />}
            <span className="font-display text-lg font-bold">{f.brand_name?.trim() || 'Pausenplaner'}</span>
            <span className="rounded-xl bg-brand-700 px-4 py-2 font-semibold text-white">Pausen automatisch planen</span>
            <span className="rounded-full bg-accent-200 px-3 py-1 text-xs font-semibold text-brand-800">heute</span>
          </div>
        </div>
      </section>

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
