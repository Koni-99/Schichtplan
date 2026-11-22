import type { Minutes } from './types';

export const pad = (n: number) => String(n).padStart(2, '0');

export function fmtMin(m: Minutes | null | undefined): string {
  if (m === null || m === undefined || Number.isNaN(m)) return '–';
  const mm = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(mm / 60))}:${pad(mm % 60)}`;
}

/** "8:30", "08.30", "0830", "8" → Minuten. Liefert null bei ungültiger Eingabe. */
export function parseTime(input: string): Minutes | null {
  const s = input.trim().replace(/\s*uhr$/i, '');
  let m = s.match(/^(\d{1,2})[:.,h](\d{2})$/);
  if (!m) m = s.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const h = +m[1], mi = +m[2];
    if (h <= 24 && mi < 60) return Math.min(h * 60 + mi, 1440);
    return null;
  }
  const h = s.match(/^(\d{1,2})$/);
  if (h && +h[1] <= 24) return +h[1] * 60;
  return null;
}

export function nowMinutes(d = new Date()): Minutes {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }): string {
  return parseISODate(iso).toLocaleDateString('de-DE', opts);
}

/** ISO-8601-Kalenderwoche → { year, week } (Jahr der KW kann vom Kalenderjahr abweichen). */
export function isoWeek(iso: string): { year: number; week: number } {
  const d = parseISODate(iso);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

export const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function minutesBetween(a: string, b: string | Date = new Date()): number {
  return ((b instanceof Date ? b.getTime() : new Date(b).getTime()) - new Date(a).getTime()) / 60000;
}

export function fmtDuration(min: number): string {
  const sign = min < 0 ? '-' : '';
  const a = Math.abs(Math.round(min));
  if (a < 60) return `${sign}${a} Min.`;
  return `${sign}${Math.floor(a / 60)}:${pad(a % 60)} Std.`;
}

export function fmtCountdown(min: number): string {
  const sign = min < 0 ? '+' : '';
  const totalSec = Math.abs(Math.round(min * 60));
  return `${sign}${Math.floor(totalSec / 60)}:${pad(totalSec % 60)}`;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function nameKey(name: string): string {
  return name.toLocaleLowerCase('de-DE').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ß]+/g, ' ').trim().split(' ').sort().join(' ');
}
