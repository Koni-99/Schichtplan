import { useMemo } from 'react';
import { useDB } from '../../store/db';
import type { DailyPlan } from '../../lib/types';
import { isoWeek } from '../../lib/time';

export function useClosedPlans(): DailyPlan[] {
  const plans = useDB((s) => s.plans);
  return useMemo(() => Object.values(plans).filter((p) => !p.deleted_at && p.status === 'closed').sort((a, b) => b.plan_date.localeCompare(a.plan_date)), [plans]);
}

export function useUnreadCount(): number {
  const closed = useClosedPlans();
  return closed.filter((p) => !p.is_read_by_hr).length;
}

export interface WeekNode { key: string; week: number; weekYear: number; days: DailyPlan[] }
export interface MonthNode { key: string; month: number; weeks: WeekNode[] }
export interface YearNode { year: number; months: MonthNode[] }

/** Jahr → Monat → KW → Tag (neueste zuerst). */
export function buildTree(plans: DailyPlan[]): YearNode[] {
  const years = new Map<number, Map<number, Map<string, WeekNode>>>();
  for (const p of plans) {
    const [y, m] = p.plan_date.split('-').map(Number);
    const { year: wy, week } = isoWeek(p.plan_date);
    const months = years.get(y) ?? years.set(y, new Map()).get(y)!;
    const weeks = months.get(m) ?? months.set(m, new Map()).get(m)!;
    const wk = `${wy}-${week}`;
    const node = weeks.get(wk) ?? weeks.set(wk, { key: `${y}-${m}-${wk}`, week, weekYear: wy, days: [] }).get(wk)!;
    node.days.push(p);
  }
  return [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => ({
      year,
      months: [...months.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([month, weeks]) => ({
          key: `${year}-${month}`,
          month,
          weeks: [...weeks.values()].sort((a, b) => b.weekYear - a.weekYear || b.week - a.week).map((w) => ({ ...w, days: w.days.sort((a, b) => b.plan_date.localeCompare(a.plan_date)) })),
        })),
    }));
}
