import { Cloud, CloudOff, HardDrive, RefreshCw } from 'lucide-react';
import { useSync, flush } from '../store/sync';
import { useDB } from '../store/db';
import { isCloudMode } from '../lib/supabase';

export function SyncIndicator() {
  const { online, syncing, realtime, error, lastSyncAt } = useSync();
  const pending = useDB((s) => Object.keys(s.outbox).length);

  if (!isCloudMode) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600 sm:inline-flex" title="Keine Supabase-Konfiguration: Daten werden nur auf diesem Gerät gespeichert.">
        <HardDrive size={14} /> Lokaler Modus
      </span>
    );
  }
  const offline = !online;
  const tone = error ? 'bg-red-100 text-red-800' : offline ? 'bg-amber-100 text-amber-900' : pending ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800';
  const text = error ? 'Sync-Fehler' : offline ? `Offline${pending ? ` · ${pending} ausstehend` : ''}` : syncing ? 'Synchronisiere …' : pending ? `${pending} ausstehend` : realtime ? 'Live' : 'Verbunden';
  return (
    <button
      onClick={() => void flush()}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${tone}`}
      title={error ?? (lastSyncAt ? `Zuletzt synchronisiert: ${new Date(lastSyncAt).toLocaleTimeString('de-DE')}` : '')}
    >
      {offline ? <CloudOff size={14} /> : syncing ? <RefreshCw size={14} className="animate-spin" /> : <Cloud size={14} />}
      {text}
    </button>
  );
}
