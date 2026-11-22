import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { TableName } from '../lib/types';
import { ackOutbox, mergeRemote, onLocalChange, setLastPulled, useDB, type AnyRow, type Change } from './db';
import { useAuth } from './auth';

interface SyncState {
  online: boolean;
  syncing: boolean;
  realtime: boolean;
  lastSyncAt: string | null;
  error: string | null;
}

export const useSync = create<SyncState>(() => ({
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  realtime: false,
  lastSyncAt: null,
  error: null,
}));

const TABLES: TableName[] = ['settings', 'employees', 'daily_plans', 'shift_entries', 'pause_blocks'];
const PAGE = 1000;
let channel: RealtimeChannel | null = null;
let flushing = false;
let flushAgain = false;
let timer: ReturnType<typeof setInterval> | undefined;
let started = false;

/** Inkrementell alle seit dem letzten Abruf geänderten Zeilen holen (mit 5 Min. Überlappung gegen Uhrzeit-Abweichungen). */
async function pull() {
  if (!supabase) return;
  for (const table of TABLES) {
    const last = useDB.getState().lastPulled[table];
    const since = last ? new Date(new Date(last).getTime() - 5 * 60000).toISOString() : '1970-01-01T00:00:00Z';
    let from = 0;
    let maxTs = last ?? '1970-01-01T00:00:00Z';
    for (;;) {
      const { data, error } = await supabase.from(table).select('*').gt('updated_at', since).order('updated_at').range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as AnyRow[];
      mergeRemote(table, rows);
      for (const r of rows) if (r.updated_at > maxTs) maxTs = r.updated_at;
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    setLastPulled(table, maxTs);
  }
}

/**
 * Reihenfolge wichtig: Pläne müssen vor ihren Schichten existieren (FK), Abschlüsse dagegen
 * zuletzt gesendet werden – sonst würde RLS die letzten Schicht-/Pausenänderungen ablehnen.
 */
function orderBatches(changes: Change[]): Change[][] {
  const by = (pred: (c: Change) => boolean) => changes.filter(pred);
  return [
    by((c) => c.table === 'settings'),
    by((c) => c.table === 'employees'),
    by((c) => c.table === 'daily_plans' && (c.row as { status: string }).status === 'open'),
    by((c) => c.table === 'shift_entries'),
    by((c) => c.table === 'pause_blocks'),
    by((c) => c.table === 'daily_plans' && (c.row as { status: string }).status === 'closed'),
  ].filter((b) => b.length);
}

async function send(batch: Change[]): Promise<{ error: { message: string; code?: string } | null }> {
  const table = batch[0].table;
  const rows = batch.map((c) => c.row);
  if (table === 'daily_plans' && useAuth.getState().role === 'personalleitung') {
    // Personalleitung darf nur aktualisieren (kein INSERT-Recht → kein Upsert)
    for (const r of rows as unknown as Array<Record<string, unknown>>) {
      const { error } = await supabase!
        .from(table)
        .update({ is_read_by_hr: r.is_read_by_hr, hr_read_at: r.hr_read_at, hr_processed: r.hr_processed, hr_processed_at: r.hr_processed_at, updated_at: r.updated_at })
        .eq('id', r.id as string);
      if (error) return { error };
    }
    return { error: null };
  }
  const { error } = await supabase!.from(table).upsert(rows, { onConflict: 'id' });
  return { error };
}

export async function flush() {
  if (!supabase || !useAuth.getState().session) return;
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  useSync.setState({ syncing: true });
  try {
    const pending = Object.values(useDB.getState().outbox);
    let lastError: string | null = null;
    for (const batch of orderBatches(pending)) {
      const { error } = await send(batch);
      if (!error) {
        ackOutbox(batch);
        continue;
      }
      if (isNetworkError(error)) throw error;
      // Batch fehlgeschlagen → einzeln senden, damit ein fehlerhafter Datensatz nicht alles blockiert
      for (const c of batch) {
        const r = await send([c]);
        if (!r.error) ackOutbox([c]);
        else if (isNetworkError(r.error)) throw r.error;
        else {
          console.warn('Datensatz vom Server abgelehnt', c, r.error);
          lastError = `Eine Änderung wurde vom Server abgelehnt: ${r.error.message}`;
          ackOutbox([c]); // verwerfen, Serverstand wird beim nächsten Abruf übernommen
        }
      }
    }
    useSync.setState({ lastSyncAt: new Date().toISOString(), error: lastError, online: true });
  } catch (e) {
    useSync.setState({ error: isNetworkError(e) ? null : String((e as Error).message ?? e), online: !isNetworkError(e) && navigator.onLine });
  } finally {
    flushing = false;
    useSync.setState({ syncing: false });
    if (flushAgain) {
      flushAgain = false;
      void flush();
    }
  }
}

function isNetworkError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e);
  return !navigator.onLine || /fetch|network|Failed to fetch|Load failed|timeout/i.test(msg);
}

async function fullSync() {
  if (!supabase || !useAuth.getState().session) return;
  try {
    await flush();
    await pull();
    useSync.setState({ lastSyncAt: new Date().toISOString(), online: true });
  } catch (e) {
    useSync.setState({ online: !isNetworkError(e) && navigator.onLine, error: isNetworkError(e) ? null : String((e as Error).message) });
  }
}

function subscribeRealtime() {
  if (!supabase || channel) return;
  channel = supabase.channel('pausenplaner-db');
  for (const table of TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      if (payload.eventType === 'DELETE') return; // es wird nur soft-gelöscht
      mergeRemote(table, [payload.new as AnyRow]);
    });
  }
  channel.subscribe((status) => {
    useSync.setState({ realtime: status === 'SUBSCRIBED' });
    if (status === 'SUBSCRIBED') void pull().catch(() => undefined); // Lücken während Verbindungsabbruch schließen
  });
}

export function startSync() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => {
    useSync.setState({ online: true });
    void fullSync();
  });
  window.addEventListener('offline', () => useSync.setState({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void fullSync();
  });
  if (!supabase) return;

  let debounce: ReturnType<typeof setTimeout> | undefined;
  onLocalChange(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void flush(), 300);
  });

  const onSession = () => {
    if (useAuth.getState().session) {
      subscribeRealtime();
      void fullSync();
    }
  };
  useAuth.subscribe((s, prev) => {
    if (s.session?.user.id !== prev.session?.user.id) onSession();
  });
  onSession();
  timer = setInterval(() => {
    if (Object.keys(useDB.getState().outbox).length) void flush();
  }, 15000);
  setInterval(() => void fullSync(), 120000);
}

export function stopSync() {
  clearInterval(timer);
}
