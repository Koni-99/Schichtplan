import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { DailyPlan, Employee, PauseBlock, Settings, ShiftEntry, TableName, TableRows } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';
import { isCloudMode } from '../lib/supabase';

export type AnyRow = TableRows[TableName];
export interface Change<T extends TableName = TableName> {
  table: T;
  row: TableRows[T];
}

interface UndoEntry {
  label: string;
  planId: string;
  at: string;
  plan: DailyPlan;
  shifts: ShiftEntry[];
  pauses: PauseBlock[];
}

export interface DataState {
  hydrated: boolean;
  employees: Record<string, Employee>;
  plans: Record<string, DailyPlan>;
  shifts: Record<string, ShiftEntry>;
  pauses: Record<string, PauseBlock>;
  settings: Settings;
  /** Noch nicht synchronisierte Änderungen (überlebt Neustarts/Offline) – key: table:id */
  outbox: Record<string, Change>;
  undo: UndoEntry[];
  lastPulled: Partial<Record<TableName, string>>;
}

const STORAGE_KEY = 'pausenplaner-state-v1';
const UNDO_LIMIT = 3;

const stateKey = { employees: 'employees', daily_plans: 'plans', shift_entries: 'shifts', pause_blocks: 'pauses' } as const;

export const useDB = create<DataState>(() => ({
  hydrated: false,
  employees: {},
  plans: {},
  shifts: {},
  pauses: {},
  settings: DEFAULT_SETTINGS,
  outbox: {},
  undo: [],
  lastPulled: {},
}));

// ------------------------------------------------------------------ Persistenz (IndexedDB)
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const { hydrated: _h, ...rest } = useDB.getState();
  idbSet(STORAGE_KEY, rest).catch((e) => console.error('IndexedDB-Speichern fehlgeschlagen', e));
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 100);
}
// Beim Schließen/Wegwechseln sofort sichern (Tablet gesperrt, App beendet)
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => saveTimer && saveNow());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveTimer && saveNow());
}

export async function hydrate() {
  try {
    const saved = (await idbGet(STORAGE_KEY)) as Partial<DataState> | undefined;
    if (saved) useDB.setState({ ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings }, hydrated: true });
    else useDB.setState({ hydrated: true });
  } catch (e) {
    console.error('IndexedDB nicht verfügbar', e);
    useDB.setState({ hydrated: true });
  }
  useDB.subscribe(scheduleSave);
}

// ------------------------------------------------------------------ Änderungen
let lastStamp = 0;
/** Streng monoton steigender Zeitstempel (Last-Write-Wins). */
export function stamp(): string {
  const t = Math.max(Date.now(), lastStamp + 1);
  lastStamp = t;
  return new Date(t).toISOString();
}

type Listener = () => void;
const changeListeners = new Set<Listener>();
export const onLocalChange = (l: Listener) => {
  changeListeners.add(l);
  return () => changeListeners.delete(l);
};

function applyRows(state: DataState, changes: Change[], toOutbox: boolean): Partial<DataState> {
  const next: Partial<DataState> = {};
  const outbox = toOutbox ? { ...state.outbox } : state.outbox;
  for (const c of changes) {
    if (c.table === 'settings') {
      next.settings = c.row as Settings;
    } else {
      const k = stateKey[c.table];
      const coll = (next[k] ?? { ...state[k] }) as Record<string, AnyRow>;
      coll[c.row.id as string] = c.row;
      (next as Record<string, unknown>)[k] = coll;
    }
    if (toOutbox) outbox[`${c.table}:${c.row.id}`] = c;
  }
  if (toOutbox) next.outbox = outbox;
  return next;
}

export function snapshotPlan(state: DataState, planId: string): Omit<UndoEntry, 'label' | 'at'> | null {
  const plan = state.plans[planId];
  if (!plan) return null;
  return {
    planId,
    plan,
    shifts: Object.values(state.shifts).filter((s) => s.plan_id === planId),
    pauses: Object.values(state.pauses).filter((p) => p.plan_id === planId),
  };
}

/** Lokale Änderung anwenden → Outbox → Sync. Optional mit Undo-Eintrag für einen Plan. */
export function commit(changes: Change[], undo?: { label: string; planId: string }) {
  if (changes.length === 0) return;
  const ts = stamp();
  const stamped = changes.map((c) => ({ table: c.table, row: { ...c.row, updated_at: ts } }) as Change);
  useDB.setState((s) => {
    const patch = applyRows(s, stamped, isCloudMode); // im lokalen Modus keine Outbox
    if (undo) {
      const snap = snapshotPlan(s, undo.planId);
      if (snap) patch.undo = [{ ...snap, label: undo.label, at: ts }, ...s.undo].slice(0, UNDO_LIMIT);
    }
    return patch;
  });
  changeListeners.forEach((l) => l());
}

/** Letzte Aktion rückgängig machen (max. 3). */
export function undoLast(): string | null {
  const s = useDB.getState();
  const entry = s.undo[0];
  if (!entry) return null;
  const now = stamp();
  const changes: Change[] = [{ table: 'daily_plans', row: entry.plan }];
  const shiftIds = new Set(entry.shifts.map((x) => x.id));
  const pauseIds = new Set(entry.pauses.map((x) => x.id));
  entry.shifts.forEach((row) => changes.push({ table: 'shift_entries', row }));
  entry.pauses.forEach((row) => changes.push({ table: 'pause_blocks', row }));
  // seitdem neu angelegte Datensätze entfernen
  Object.values(s.shifts).forEach((row) => {
    if (row.plan_id === entry.planId && !shiftIds.has(row.id) && !row.deleted_at) changes.push({ table: 'shift_entries', row: { ...row, deleted_at: now } });
  });
  Object.values(s.pauses).forEach((row) => {
    if (row.plan_id === entry.planId && !pauseIds.has(row.id) && !row.deleted_at) changes.push({ table: 'pause_blocks', row: { ...row, deleted_at: now } });
  });
  useDB.setState({ undo: s.undo.slice(1) });
  commit(changes);
  return entry.label;
}

/** Daten vom Server übernehmen (Realtime/Pull). Lokale, noch ausstehende neuere Änderungen gewinnen. */
export function mergeRemote(table: TableName, rows: AnyRow[]) {
  if (rows.length === 0) return;
  useDB.setState((s) => {
    const accepted: Change[] = [];
    for (const row of rows) {
      const pending = s.outbox[`${table}:${row.id}`];
      if (pending && pending.row.updated_at >= row.updated_at) continue;
      const current = table === 'settings' ? s.settings : (s[stateKey[table as Exclude<TableName, 'settings'>]] as Record<string, AnyRow>)[row.id as string];
      if (current && current.updated_at > row.updated_at) continue;
      accepted.push({ table, row } as Change);
    }
    return accepted.length ? applyRows(s, accepted, false) : {};
  });
}

export function ackOutbox(sent: Change[]) {
  useDB.setState((s) => {
    const outbox = { ...s.outbox };
    for (const c of sent) {
      const k = `${c.table}:${c.row.id}`;
      if (outbox[k] && outbox[k].row.updated_at === c.row.updated_at) delete outbox[k];
    }
    return { outbox };
  });
}

export function setLastPulled(table: TableName, ts: string) {
  useDB.setState((s) => ({ lastPulled: { ...s.lastPulled, [table]: ts } }));
}
