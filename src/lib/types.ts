/** Alle Uhrzeiten innerhalb eines Tages = Minuten seit Mitternacht (z. B. 08:30 = 510). */
export type Minutes = number;

export type Role = 'filiale' | 'filialleitung' | 'personalleitung';
export type PauseModel = 'standard' | 'flexible_custom' | 'fixed' | 'none';
export type ShiftStatus = 'present' | 'sick' | 'left_early' | 'came_late' | 'absent' | 'removed';

/** Krank, nicht erschienen oder aus dem Plan entfernt: keine Arbeitszeit, keine Pausen. */
export const isNotWorking = (s: ShiftStatus) => s === 'sick' || s === 'absent' || s === 'removed';
export type PauseStatus = 'open' | 'running' | 'done' | 'cancelled';
export type PlanStatus = 'open' | 'closed';
export type ClosedType = 'manual' | 'auto';

export interface Row {
  id: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Settings {
  id: 1;
  max_concurrent_pauses: number;
  auto_close_time: Minutes;
  auto_close_enabled: boolean;
  min_after_start_min: number;
  min_between_blocks_min: number;
  min_before_end_min: number;
  /** Letzte Pause startet spätestens um (Minuten), null = keine Grenze */
  latest_pause_start?: Minutes | null;
  default_block_count: number;
  default_block_minutes: number;
  short_shift_threshold_min: number;
  short_shift_block_count: number;
  short_shift_block_minutes: number;
  count_unstarted_as_taken: boolean;
  timezone: string;
  /** Darstellung: Name der Bäckerei/Filiale, Logo (Data-URL), Firmenfarbe */
  brand_name?: string | null;
  brand_logo?: string | null;
  brand_color?: string | null;
  brand_accent?: string | null;
  updated_at: string;
}

export interface Employee extends Row {
  name: string;
  name_key: string;
  pause_model: PauseModel;
  custom_block_count: number;
  custom_block_minutes: number;
  fixed_starts: Minutes[];
  fixed_block_minutes: number;
  active: boolean;
  created_at: string;
}

export interface DailyPlan extends Row {
  plan_date: string; // YYYY-MM-DD
  status: PlanStatus;
  closed_at: string | null;
  closed_type: ClosedType | null;
  closed_by: string | null;
  closed_label: string | null;
  is_read_by_hr: boolean;
  hr_read_at: string | null;
  hr_processed: boolean;
  hr_processed_at: string | null;
  has_deviations: boolean;
  source_filename: string | null;
  created_at: string;
}

export interface ShiftEntry extends Row {
  plan_id: string;
  employee_id: string | null;
  employee_name: string;
  planned_start_min: Minutes | null;
  planned_end_min: Minutes | null;
  actual_start_min: Minutes | null;
  actual_end_min: Minutes | null;
  planned_pause_min: number;
  actual_pause_min: number | null;
  status: ShiftStatus;
  /** gesetzt, wenn die Filialleitung den Eintrag aus dem Plan entfernt hat (Vermerk für die Personalleitung) */
  removed_reason?: string | null;
  removed_at?: string | null;
  removed_by_name?: string | null;
  is_manual: boolean;
  note: string;
  sort_order: number;
  created_at: string;
}

export interface PauseBlock extends Row {
  plan_id: string;
  shift_entry_id: string;
  block_no: number;
  start_min: Minutes;
  planned_duration_min: number;
  is_fixed: boolean;
  status: PauseStatus;
  actual_start_at: string | null;
  actual_end_at: string | null;
  actual_duration_min: number | null;
  created_at: string;
}

export type TableName = 'settings' | 'employees' | 'daily_plans' | 'shift_entries' | 'pause_blocks';

export interface TableRows {
  settings: Settings;
  employees: Employee;
  daily_plans: DailyPlan;
  shift_entries: ShiftEntry;
  pause_blocks: PauseBlock;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 1,
  max_concurrent_pauses: 4,
  auto_close_time: 19 * 60 + 30,
  auto_close_enabled: true,
  min_after_start_min: 90,
  min_between_blocks_min: 90,
  min_before_end_min: 60,
  latest_pause_start: 15 * 60 + 30,
  default_block_count: 2,
  default_block_minutes: 30,
  short_shift_threshold_min: 360,
  short_shift_block_count: 0,
  short_shift_block_minutes: 15,
  count_unstarted_as_taken: false,
  timezone: 'Europe/Berlin',
  // Standard-Name kommt aus der .env (VITE_BRAND_NAME), damit er nicht im Code steht
  brand_name: (import.meta.env?.VITE_BRAND_NAME as string | undefined) ?? '',
  brand_logo: null,
  brand_color: '#6b4226',
  brand_accent: '#e8a90c',
  updated_at: new Date(0).toISOString(),
};

export const SHIFT_STATUS_LABEL: Record<ShiftStatus, string> = {
  present: 'Anwesend',
  sick: 'Krank',
  left_early: 'Früher gegangen',
  came_late: 'Später gekommen',
  absent: 'Nicht erschienen',
  removed: 'Aus Plan entfernt',
};

export const PAUSE_MODEL_LABEL: Record<PauseModel, string> = {
  standard: 'Standard (2 × 30 Min. flexibel)',
  flexible_custom: 'Sondermodell flexibel',
  fixed: 'Feste Pausen-Uhrzeiten',
  none: 'Keine Pause',
};
