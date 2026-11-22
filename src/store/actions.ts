import { commit, useDB, type Change } from './db';
import { useAuth } from './auth';
import type { DailyPlan, Employee, Minutes, PauseBlock, Settings, ShiftEntry, ShiftStatus } from '../lib/types';
import { isNotWorking, SHIFT_STATUS_LABEL } from '../lib/types';
import { fmtMin, nameKey, nowMinutes, todayISO, uid } from '../lib/time';
import { schedulePauses } from '../lib/scheduler';
import { computeActualPause, diffPlan, planHasDeviations } from '../lib/diff';

const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ Selektoren
export function planShifts(planId: string, s = useDB.getState()): ShiftEntry[] {
  return Object.values(s.shifts)
    .filter((x) => x.plan_id === planId && !x.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order);
}
export function planPauses(planId: string, s = useDB.getState()): PauseBlock[] {
  return Object.values(s.pauses).filter((x) => x.plan_id === planId && !x.deleted_at);
}
export function planByDate(date: string, s = useDB.getState()): DailyPlan | undefined {
  return Object.values(s.plans).find((p) => p.plan_date === date && !p.deleted_at);
}

// ------------------------------------------------------------------ Mitarbeiter-Stammdaten
export function newEmployee(name: string): Employee {
  const ts = nowIso();
  return {
    id: uid(),
    name: name.trim(),
    name_key: nameKey(name),
    pause_model: 'standard',
    custom_block_count: 2,
    custom_block_minutes: 15,
    fixed_starts: [],
    fixed_block_minutes: 30,
    active: true,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  };
}

export function findEmployeeByName(name: string): Employee | undefined {
  const k = nameKey(name);
  return Object.values(useDB.getState().employees).find((e) => !e.deleted_at && e.name_key === k);
}

export function saveEmployee(emp: Employee) {
  commit([{ table: 'employees', row: { ...emp, name: emp.name.trim(), name_key: nameKey(emp.name) } }]);
}

export function deleteEmployee(id: string) {
  const emp = useDB.getState().employees[id];
  if (emp) commit([{ table: 'employees', row: { ...emp, deleted_at: nowIso(), active: false } }]);
}

export function saveSettings(patch: Partial<Settings>) {
  commit([{ table: 'settings', row: { ...useDB.getState().settings, ...patch } }]);
}

// ------------------------------------------------------------------ Import / Planerstellung
export interface ImportRow {
  name: string;
  start: Minutes;
  end: Minutes;
}

/** Legt (ggf. ersetzend) einen Tagesplan aus den geprüften Importdaten an und plant die Pausen. */
export function createPlanFromImport(date: string, rows: ImportRow[], filename: string | null, replaceExisting: boolean): string {
  const state = useDB.getState();
  const changes: Change[] = [];
  const ts = nowIso();

  const existing = planByDate(date, state);
  if (existing) {
    if (!replaceExisting) throw new Error('Für dieses Datum existiert bereits ein Plan.');
    if (existing.status === 'closed') throw new Error('Abgeschlossene Tage können nicht ersetzt werden.');
    if (existing.plan_date === todayISO()) throw new Error('Der heutige Tagesplan kann nicht per Import ersetzt werden – bitte direkt im Tagesplan ändern.');
    changes.push({ table: 'daily_plans', row: { ...existing, deleted_at: ts } });
    planShifts(existing.id, state).forEach((row) => changes.push({ table: 'shift_entries', row: { ...row, deleted_at: ts } }));
    planPauses(existing.id, state).forEach((row) => changes.push({ table: 'pause_blocks', row: { ...row, deleted_at: ts } }));
  }

  const plan: DailyPlan = {
    id: uid(),
    plan_date: date,
    status: 'open',
    closed_at: null,
    closed_type: null,
    closed_by: null,
    closed_label: null,
    is_read_by_hr: false,
    hr_read_at: null,
    hr_processed: false,
    hr_processed_at: null,
    has_deviations: false,
    source_filename: filename,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  };
  changes.push({ table: 'daily_plans', row: plan });

  const empByKey = new Map(Object.values(state.employees).filter((e) => !e.deleted_at).map((e) => [e.name_key, e]));
  const employees: Record<string, Employee> = { ...state.employees };
  const shifts: ShiftEntry[] = rows.map((r, i) => {
    let emp = empByKey.get(nameKey(r.name));
    if (!emp) {
      emp = newEmployee(r.name); // automatisch in Stammdaten anlegen
      empByKey.set(emp.name_key, emp);
      employees[emp.id] = emp;
      changes.push({ table: 'employees', row: emp });
    }
    return {
      id: uid(),
      plan_id: plan.id,
      employee_id: emp.id,
      employee_name: emp.name,
      planned_start_min: r.start,
      planned_end_min: r.end,
      actual_start_min: null,
      actual_end_min: null,
      planned_pause_min: 0,
      actual_pause_min: null,
      status: 'present',
      is_manual: false,
      note: '',
      sort_order: i,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
  });

  const sched = schedulePauses({ shifts, pauses: [], employees, settings: state.settings });
  for (const sh of shifts) {
    sh.planned_pause_min = sched.plannedPauseByShift[sh.id] ?? 0;
    changes.push({ table: 'shift_entries', row: sh });
  }
  for (const b of sched.blocks) changes.push({ table: 'pause_blocks', row: makeBlock(plan.id, b.shiftId, b.blockNo, b.start, b.duration, b.isFixed) });

  commit(changes);
  return plan.id;
}

function makeBlock(planId: string, shiftId: string, blockNo: number, start: Minutes, duration: number, isFixed: boolean): PauseBlock {
  const ts = nowIso();
  return {
    id: uid(),
    plan_id: planId,
    shift_entry_id: shiftId,
    block_no: blockNo,
    start_min: start,
    planned_duration_min: duration,
    is_fixed: isFixed,
    status: 'open',
    actual_start_at: null,
    actual_end_at: null,
    actual_duration_min: null,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  };
}

/** Button „Pausen automatisch planen“: offene Blöcke neu verteilen, laufende/erledigte bleiben. */
export function autoSchedule(planId: string): string[] {
  const s = useDB.getState();
  const shifts = planShifts(planId, s);
  const pauses = planPauses(planId, s);
  const sched = schedulePauses({ shifts, pauses, employees: s.employees, settings: s.settings, now: new Date() });
  const changes: Change[] = [];
  const byId = new Map(pauses.map((p) => [p.id, p]));

  for (const b of sched.blocks) {
    const ex = b.existingId ? byId.get(b.existingId) : undefined;
    if (ex) {
      if (ex.status === 'running' || ex.status === 'done') continue;
      if (ex.start_min !== b.start || ex.planned_duration_min !== b.duration || ex.status !== 'open' || ex.is_fixed !== b.isFixed) {
        changes.push({ table: 'pause_blocks', row: { ...ex, start_min: b.start, planned_duration_min: b.duration, status: 'open', is_fixed: b.isFixed } });
      }
    } else {
      changes.push({ table: 'pause_blocks', row: makeBlock(planId, b.shiftId, b.blockNo, b.start, b.duration, b.isFixed) });
    }
  }
  for (const id of sched.cancelIds) {
    const ex = byId.get(id);
    if (ex && ex.status === 'open') changes.push({ table: 'pause_blocks', row: { ...ex, status: 'cancelled' } });
  }
  for (const sh of shifts) {
    // Soll-Pause nur für reguläre/manuelle Schichten nachziehen (Profil/Einstellungen geändert);
    // bei Statusänderungen bleibt das ursprüngliche Soll für den PEPZeit-Abgleich erhalten.
    const soll = sched.plannedPauseByShift[sh.id];
    if (soll !== undefined && soll !== sh.planned_pause_min && (sh.status === 'present' || sh.is_manual)) {
      changes.push({ table: 'shift_entries', row: { ...sh, planned_pause_min: soll } });
    }
  }
  commit(changes, { label: 'Pausen automatisch geplant', planId });
  return sched.warnings;
}

// ------------------------------------------------------------------ Pausen
function updatePause(id: string, patch: Partial<PauseBlock>, label: string) {
  const p = useDB.getState().pauses[id];
  if (!p) return;
  commit([{ table: 'pause_blocks', row: { ...p, ...patch } }], { label, planId: p.plan_id });
}

export function movePause(id: string, start: Minutes) {
  const p = useDB.getState().pauses[id];
  if (!p || p.start_min === start) return;
  updatePause(id, { start_min: Math.max(0, Math.min(1439, Math.round(start))) }, `Pause verschoben auf ${fmtMin(start)}`);
}

export function setPauseDuration(id: string, minutes: number) {
  updatePause(id, { planned_duration_min: Math.max(5, Math.round(minutes)) }, 'Pausendauer geändert');
}

export function startPause(id: string) {
  const now = new Date();
  updatePause(id, { status: 'running', actual_start_at: now.toISOString(), actual_end_at: null, actual_duration_min: null, start_min: Math.floor(nowMinutes(now)) }, 'Pause gestartet');
}

export function endPause(id: string) {
  const p = useDB.getState().pauses[id];
  if (!p?.actual_start_at) return;
  const now = new Date();
  const dur = Math.max(1, Math.round((now.getTime() - new Date(p.actual_start_at).getTime()) / 60000));
  updatePause(id, { status: 'done', actual_end_at: now.toISOString(), actual_duration_min: dur }, 'Pause beendet');
}

/** Erledigte Pause nachträglich korrigieren oder als genommen eintragen (ohne Live-Timer). */
export function setPauseActual(id: string, start: Minutes, durationMin: number) {
  updatePause(id, { status: 'done', start_min: start, actual_duration_min: Math.max(0, Math.round(durationMin)) }, 'Ist-Pause eingetragen');
}

export function resetPause(id: string) {
  updatePause(id, { status: 'open', actual_start_at: null, actual_end_at: null, actual_duration_min: null }, 'Pause zurückgesetzt');
}

export function cancelPause(id: string) {
  updatePause(id, { status: 'cancelled' }, 'Pause gestrichen');
}

export function addPauseBlock(shiftId: string, start: Minutes, duration: number) {
  const s = useDB.getState();
  const sh = s.shifts[shiftId];
  if (!sh) return;
  const nos = planPauses(sh.plan_id, s).filter((p) => p.shift_entry_id === shiftId).map((p) => p.block_no);
  const no = (nos.length ? Math.max(...nos) : 0) + 1;
  commit([{ table: 'pause_blocks', row: makeBlock(sh.plan_id, shiftId, no, start, duration, false) }], { label: `Pausenblock ${no} hinzugefügt`, planId: sh.plan_id });
}

// ------------------------------------------------------------------ Schichten
function updateShift(id: string, patch: Partial<ShiftEntry>, label: string, extra: Change[] = []) {
  const sh = useDB.getState().shifts[id];
  if (!sh) return;
  commit([{ table: 'shift_entries', row: { ...sh, ...patch } }, ...extra], { label, planId: sh.plan_id });
}

/** Status-Umschalter inkl. Folgeänderungen an den Pausen. */
export function setShiftStatus(id: string, status: ShiftStatus, time?: Minutes) {
  const s = useDB.getState();
  const sh = s.shifts[id];
  if (!sh) return;
  const own = planPauses(sh.plan_id, s).filter((p) => p.shift_entry_id === id);
  const extra: Change[] = [];
  const patch: Partial<ShiftEntry> = { status };

  if (isNotWorking(status)) {
    // offene Pausen automatisch aus der Planung streichen
    own.filter((p) => p.status === 'open').forEach((p) => extra.push({ table: 'pause_blocks', row: { ...p, status: 'cancelled' } }));
    patch.actual_start_min = null;
    patch.actual_end_min = null;
  } else {
    if (isNotWorking(sh.status)) {
      own.filter((p) => p.status === 'cancelled').forEach((p) => extra.push({ table: 'pause_blocks', row: { ...p, status: 'open' } }));
    }
    if (status === 'left_early') {
      const end = time ?? Math.round(nowMinutes());
      patch.actual_end_min = end;
      own.filter((p) => p.status === 'open' && p.start_min >= end).forEach((p) => extra.push({ table: 'pause_blocks', row: { ...p, status: 'cancelled' } }));
    }
    if (status === 'came_late') patch.actual_start_min = time ?? Math.round(nowMinutes());
    if (status === 'present') {
      patch.actual_start_min = null;
      patch.actual_end_min = null;
    }
  }
  if (sh.status === 'removed') {
    patch.removed_reason = null;
    patch.removed_at = null;
    patch.removed_by_name = null;
  }
  updateShift(id, patch, `${sh.employee_name}: ${SHIFT_STATUS_LABEL[status]}`, extra);
}

/**
 * Filialleitung: Mitarbeiter aus dem Plan entfernen (z. B. Fehler im PEPZeit-PDF).
 * Der Eintrag bleibt für die Personalleitung mit Grund, Uhrzeit und Name sichtbar.
 */
export function removeFromPlan(id: string, reason: string) {
  const s = useDB.getState();
  const sh = s.shifts[id];
  if (!sh) return;
  const now = new Date();
  const extra: Change[] = planPauses(sh.plan_id, s)
    .filter((p) => p.shift_entry_id === id && (p.status === 'open' || p.status === 'running'))
    .map((p) =>
      p.status === 'running' && p.actual_start_at
        ? ({ table: 'pause_blocks', row: { ...p, status: 'done', actual_end_at: now.toISOString(), actual_duration_min: Math.max(1, Math.round((now.getTime() - new Date(p.actual_start_at).getTime()) / 60000)) } } as Change)
        : ({ table: 'pause_blocks', row: { ...p, status: 'cancelled' } } as Change),
    );
  updateShift(
    id,
    { status: 'removed', removed_reason: reason.trim(), removed_at: now.toISOString(), removed_by_name: useAuth.getState().displayName || 'Filialleitung', actual_start_min: null, actual_end_min: null },
    `${sh.employee_name} aus Plan entfernt`,
    extra,
  );
}

export function setActualTimes(id: string, start: Minutes | null, end: Minutes | null) {
  const sh = useDB.getState().shifts[id];
  if (!sh) return;
  const patch: Partial<ShiftEntry> = { actual_start_min: start, actual_end_min: end };
  if (sh.status === 'present' || sh.status === 'came_late' || sh.status === 'left_early') {
    const late = start != null && sh.planned_start_min != null && start > sh.planned_start_min;
    const early = end != null && sh.planned_end_min != null && end < sh.planned_end_min;
    patch.status = early ? 'left_early' : late ? 'came_late' : 'present';
  }
  updateShift(id, patch, `${sh.employee_name}: Ist-Zeiten geändert`);
}

export function setNote(id: string, note: string) {
  const sh = useDB.getState().shifts[id];
  if (!sh || sh.note === note) return;
  updateShift(id, { note }, `${sh.employee_name}: Notiz`);
}

/** Schichten (inkl. Pausen) zweier Mitarbeiter tauschen: die Personen wechseln die Zeilen. */
export function swapShifts(aId: string, bId: string) {
  const s = useDB.getState();
  const a = s.shifts[aId], b = s.shifts[bId];
  if (!a || !b) return;
  commit(
    [
      { table: 'shift_entries', row: { ...a, employee_id: b.employee_id, employee_name: b.employee_name, note: appendNote(b.note, `Schicht getauscht mit ${a.employee_name}`) } },
      { table: 'shift_entries', row: { ...b, employee_id: a.employee_id, employee_name: a.employee_name, note: appendNote(a.note, `Schicht getauscht mit ${b.employee_name}`) } },
    ],
    { label: `Schicht getauscht: ${a.employee_name} ↔ ${b.employee_name}`, planId: a.plan_id },
  );
}

const appendNote = (note: string, add: string) => (note.trim() ? `${note.trim()} · ${add}` : add);

/** Spontane Aushilfe/Springer hinzufügen (für die Personalleitung als „Manuell ergänzt“ markiert). */
export function addSpringer(planId: string, name: string, start: Minutes, end: Minutes, withPauses: boolean) {
  const s = useDB.getState();
  const emp = findEmployeeByName(name);
  const ts = nowIso();
  const shifts = planShifts(planId, s);
  const sh: ShiftEntry = {
    id: uid(),
    plan_id: planId,
    employee_id: emp?.id ?? null,
    employee_name: emp?.name ?? name.trim(),
    planned_start_min: null,
    planned_end_min: null,
    actual_start_min: start,
    actual_end_min: end,
    planned_pause_min: 0,
    actual_pause_min: null,
    status: 'present',
    is_manual: true,
    note: '',
    sort_order: (shifts.length ? Math.max(...shifts.map((x) => x.sort_order)) : 0) + 1,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  };
  const changes: Change[] = [];
  if (withPauses) {
    const sched = schedulePauses({ shifts: [...shifts, sh], pauses: planPauses(planId, s), employees: s.employees, settings: s.settings, now: new Date() });
    sh.planned_pause_min = sched.plannedPauseByShift[sh.id] ?? 0;
    sched.blocks.filter((b) => b.shiftId === sh.id).forEach((b) => changes.push({ table: 'pause_blocks', row: makeBlock(planId, sh.id, b.blockNo, b.start, b.duration, b.isFixed) }));
  }
  commit([{ table: 'shift_entries', row: sh }, ...changes], { label: `Springer ${sh.employee_name} hinzugefügt`, planId });
}

export function removeShift(id: string) {
  const s = useDB.getState();
  const sh = s.shifts[id];
  if (!sh) return;
  const ts = nowIso();
  const extra: Change[] = planPauses(sh.plan_id, s)
    .filter((p) => p.shift_entry_id === id)
    .map((p) => ({ table: 'pause_blocks', row: { ...p, deleted_at: ts } }) as Change);
  updateShift(id, { deleted_at: ts }, `${sh.employee_name} entfernt`, extra);
}

// ------------------------------------------------------------------ Tagesabschluss
export function closePlan(planId: string, type: 'manual' | 'auto') {
  const s = useDB.getState();
  const plan = s.plans[planId];
  if (!plan || plan.status === 'closed') return;
  const now = new Date();
  const changes: Change[] = [];
  const pauses = planPauses(planId, s).map((p) => {
    if (p.status === 'running' && p.actual_start_at) {
      const done: PauseBlock = { ...p, status: 'done', actual_end_at: now.toISOString(), actual_duration_min: Math.max(1, Math.round((now.getTime() - new Date(p.actual_start_at).getTime()) / 60000)) };
      changes.push({ table: 'pause_blocks', row: done });
      return done;
    }
    return p;
  });
  const shifts = planShifts(planId, s).map((sh) => {
    const notWorking = isNotWorking(sh.status);
    const frozen: ShiftEntry = { ...sh, actual_pause_min: notWorking ? 0 : computeActualPause({ ...sh, actual_pause_min: null }, pauses, s.settings, now) };
    changes.push({ table: 'shift_entries', row: frozen });
    return frozen;
  });
  const deviations = planHasDeviations(diffPlan(plan, shifts, pauses, s.settings));
  const label = type === 'auto' ? `Automatisch abgeschlossen um ${fmtMin(s.settings.auto_close_time)} Uhr` : `Manuell abgeschlossen von ${useAuth.getState().displayName || 'Filiale'}`;
  changes.push({
    table: 'daily_plans',
    row: { ...plan, status: 'closed', closed_at: now.toISOString(), closed_type: type, closed_label: label, closed_by: useAuth.getState().session?.user.id ?? null, is_read_by_hr: false, has_deviations: deviations },
  });
  commit(changes);
  useDB.setState((st) => ({ undo: st.undo.filter((u) => u.planId !== planId) }));
}

/** Client-seitiger Fallback für den Auto-Abschluss (Server-Cron ist die primäre Instanz). */
export function autoCloseDuePlans() {
  const s = useDB.getState();
  if (!s.settings.auto_close_enabled) return;
  const today = todayISO();
  const nowM = nowMinutes();
  Object.values(s.plans).forEach((p) => {
    if (p.deleted_at || p.status !== 'open') return;
    if (p.plan_date < today || (p.plan_date === today && nowM >= s.settings.auto_close_time)) closePlan(p.id, 'auto');
  });
}

// ------------------------------------------------------------------ Personalleitung
export function markHrRead(planId: string) {
  const p = useDB.getState().plans[planId];
  if (!p || p.is_read_by_hr) return;
  commit([{ table: 'daily_plans', row: { ...p, is_read_by_hr: true, hr_read_at: nowIso() } }]);
}

export function setHrProcessed(planId: string, processed: boolean) {
  const p = useDB.getState().plans[planId];
  if (!p) return;
  commit([{ table: 'daily_plans', row: { ...p, hr_processed: processed, hr_processed_at: processed ? nowIso() : null, is_read_by_hr: true, hr_read_at: p.hr_read_at ?? nowIso() } }]);
}

