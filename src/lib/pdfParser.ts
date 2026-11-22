import type { Minutes } from './types';
import { nameKey, pad } from './time';

export interface ParsedShift {
  name: string;
  start: Minutes;
  end: Minutes;
}

export interface ParsedDay {
  date: string; // YYYY-MM-DD
  shifts: ParsedShift[];
}

export type PdfLayout = 'single' | 'sections' | 'columns' | 'pages';

/** Ergebnis für ein ganzes PDF (Tages- oder Wochenplan). */
export interface WeekParseResult {
  layout: PdfLayout;
  days: ParsedDay[];
  /** Schichten ohne erkennbares Datum (nur wenn das PDF gar kein Datum enthält) */
  undated: ParsedShift[];
  lines: string[];
  warnings: string[];
}

/** Rückwärtskompatibel: ein einzelner Tag. */
export interface ParseResult {
  date: string | null;
  shifts: ParsedShift[];
  lines: string[];
  warnings: string[];
}

// ------------------------------------------------------------------ Text mit Positionen
export interface PdfItem { x: number; y: number; w: number; s: string }
interface Span { start: number; end: number; x: number; w: number }
export interface PdfLine { text: string; spans: Span[] }

const TIME = String.raw`([01]?\d|2[0-4])[:.]([0-5]\d)`;
const RANGE_RE = new RegExp(String.raw`${TIME}\s*(?:Uhr)?\s*(?:-|–|—|bis)\s*${TIME}`, 'gi');
const SINGLE_RE = new RegExp(String.raw`(?<![\d.])${TIME}(?![\d.])`, 'g');
/** volles (23.11.2026 / 23.11.26) oder verkürztes Datum (23.11.) */
const DATE_RE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2}(?![\d:.]))?(?![\d:])/g;
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const WD_RE = /(?<![A-Za-zÄÖÜäöüß])(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Mo|Di|Mi|Do|Fr|Sa|So)(?![a-zäöüß])\.?/g;
const KW_RE = /\bKW\s*(\d{1,2})(?:\s*[/.-]\s*|\s+)?(\d{4})?/i;

/** Wörter, die keine Mitarbeiternamen sind (Kopf-/Fußzeilen, Spaltentitel). */
const STOP_WORDS = [
  'datum', 'mitarbeiter', 'name', 'summe', 'gesamt', 'filiale', 'seite', 'schichtplan', 'dienstplan', 'wochenplan', 'pepzeit', 'woche',
  'kw', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag', 'mo', 'di', 'mi', 'do', 'fr', 'sa', 'so',
  'beginn', 'ende', 'pause', 'stunden', 'gedruckt', 'erstellt', 'stand', 'planung', 'abteilung', 'kostenstelle', 'von', 'bis',
  'uhrzeit', 'zeit', 'soll', 'ist', 'tag', 'nr', 'pers',
];
/** Abwesenheitskürzel in Wochenplänen – kein Name, keine Schicht */
const ABSENCE_RE = /\b(frei|urlaub|krank|berufsschule|schule|feiertag|ausgleich|U|K|F|BS)\b/i;
const FOOTER_RE = /\b(gedruckt|erstellt|druckdatum|stand)\b/i;

const toMin = (h: string, m: string) => Number(h) * 60 + Number(m);

export function itemsToLines(pages: PdfItem[][]): PdfLine[] {
  const out: PdfLine[] = [];
  for (const items of pages) {
    const sorted = [...items].filter((i) => i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PdfItem[][] = [];
    for (const it of sorted) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= 3);
      if (row) row.push(it);
      else rows.push([it]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      let text = '';
      const spans: Span[] = [];
      let lastEnd = -Infinity;
      for (const it of row) {
        if (text && it.x - lastEnd > 1) text += ' ';
        spans.push({ start: text.length, end: text.length + it.s.length, x: it.x, w: it.w || it.s.length * 5 });
        text += it.s;
        lastEnd = it.x + it.w;
      }
      out.push({ text, spans });
    }
  }
  return out;
}

const plainLine = (text: string): PdfLine => ({ text, spans: [{ start: 0, end: text.length, x: 0, w: Math.max(1, text.length) * 5 }] });

function xAt(line: PdfLine, idx: number): number {
  for (const s of line.spans) {
    if (idx >= s.start && idx < s.end) return s.x + ((idx - s.start) / Math.max(1, s.end - s.start)) * s.w;
  }
  const last = line.spans[line.spans.length - 1];
  return last ? last.x + last.w : idx * 5;
}

function cleanName(raw: string): string {
  return raw
    .replace(new RegExp(DATE_RE.source, 'g'), ' ')
    .replace(/\b\d+\b/g, ' ') // Personalnummern
    .replace(/[|;:_•·*()[\]]/g, ' ')
    .replace(/\b(Uhr|Std|h)\b\.?/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.\-–]+|[\s,.\-–]+$/g, '')
    .trim();
}

function looksLikeName(s: string): boolean {
  if (s.length < 2 || !/[A-Za-zÄÖÜäöüß]{2,}/.test(s)) return false;
  const words = s.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;
  return !words.every((w) => STOP_WORDS.includes(w.replace(/[^a-zäöüß]/g, '')));
}

// ------------------------------------------------------------------ Datums-Hilfen
interface DateTok { idx: number; day: number; month: number; year: number | null }
function findDates(text: string): DateTok[] {
  const out: DateTok[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const day = +m[1], month = +m[2];
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    let year = m[3] ? +m[3] : null;
    if (year !== null && year < 100) year += 2000;
    out.push({ idx: m.index ?? 0, day, month, year });
  }
  return out;
}
interface WdTok { idx: number; wd: number }
function findWeekdays(text: string): WdTok[] {
  return [...text.matchAll(WD_RE)].map((m) => ({ idx: m.index ?? 0, wd: WEEKDAYS.findIndex((w) => w.startsWith(m[1])) }));
}
const hasTimes = (t: string) => { RANGE_RE.lastIndex = 0; return RANGE_RE.test(t) || [...t.replace(new RegExp(DATE_RE.source, 'g'), ' ').matchAll(SINGLE_RE)].length >= 2; };

const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function mondayOf(y: number, m: number, d: number): Date {
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return dt;
}
function isoWeekMonday(week: number, year: number): Date {
  const mon = mondayOf(year, 1, 4); // Woche mit dem 4. Januar = KW 1
  mon.setDate(mon.getDate() + (week - 1) * 7);
  return mon;
}
const dateToIso = (d: Date) => iso(d.getFullYear(), d.getMonth() + 1, d.getDate());

/** Bezugsjahr und Montag der Woche aus dem gesamten Dokument ableiten. */
function documentContext(lines: PdfLine[]): { year: number; monday: Date | null } {
  let year: number | null = null;
  let monday: Date | null = null;
  for (const l of lines) {
    const full = findDates(l.text).find((d) => d.year !== null);
    if (full && year === null) {
      year = full.year!;
      if (!FOOTER_RE.test(l.text)) monday = mondayOf(full.year!, full.month, full.day);
    }
    const kw = l.text.match(KW_RE);
    if (kw && !monday) {
      const y: number = kw[2] ? +kw[2] : year ?? new Date().getFullYear();
      monday = isoWeekMonday(+kw[1], y);
      year ??= y;
    }
  }
  return { year: year ?? new Date().getFullYear(), monday };
}

function resolveDate(tok: DateTok | undefined, wd: number | undefined, ctx: { year: number; monday: Date | null }): string | null {
  if (tok) return iso(tok.year ?? ctx.year, tok.month, tok.day);
  if (wd !== undefined && wd >= 0 && ctx.monday) {
    const d = new Date(ctx.monday);
    d.setDate(d.getDate() + wd);
    return dateToIso(d);
  }
  return null;
}

// ------------------------------------------------------------------ Zeilenweise Schichterkennung
interface RowShift extends ParsedShift { date?: string | null }

/**
 * Eine Gruppe von Zeilen auswerten: jede Zeile mit Name + Zeitspanne wird zu einer Schicht
 * ("Müller, Anna 05:30 - 14:00"). Unterstützt Einzelzeiten ohne Bindestrich, Namen in der
 * Vorzeile sowie Listen mit Datum/Wochentag pro Zeile.
 */
function parseRows(lines: string[], ctx: { year: number; monday: Date | null }, warnings: string[]): RowShift[] {
  const found: RowShift[] = [];
  let pendingName: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const rowDate = findDates(line)[0];
    const lead = findWeekdays(line).find((w) => w.idx < 3);
    const lineNoDate = line.replace(new RegExp(DATE_RE.source, 'g'), ' ');

    let start: number | null = null, end: number | null = null, firstIdx = -1;
    RANGE_RE.lastIndex = 0;
    const r = RANGE_RE.exec(lineNoDate);
    if (r) {
      start = toMin(r[1], r[2]);
      end = toMin(r[3], r[4]);
      firstIdx = r.index;
    } else {
      const singles = [...lineNoDate.matchAll(SINGLE_RE)];
      if (singles.length >= 2) {
        start = toMin(singles[0][1], singles[0][2]);
        end = toMin(singles[1][1], singles[1][2]);
        firstIdx = singles[0].index ?? 0;
      }
    }

    if (start === null || end === null) {
      const n = cleanName(lineNoDate);
      pendingName = looksLikeName(n) && !ABSENCE_RE.test(lineNoDate) ? n : null;
      continue;
    }

    const stripWd = (s: string) => s.replace(new RegExp(WD_RE.source, 'g'), ' ');
    let name = cleanName(stripWd(lineNoDate.slice(0, firstIdx)));
    if (!looksLikeName(name)) {
      const after = cleanName(stripWd(lineNoDate.slice(firstIdx).replace(RANGE_RE, ' ').replace(SINGLE_RE, ' ')));
      if (looksLikeName(after)) name = after;
      else if (pendingName) name = pendingName;
      else continue;
    }
    pendingName = null;
    if (end <= start) warnings.push(`${name}: Ende (${pad(Math.floor(end / 60))}:${pad(end % 60)}) liegt vor Beginn – bitte prüfen.`);
    if (start < 4 * 60 || end > 22 * 60) warnings.push(`${name}: ungewöhnliche Uhrzeit – bitte prüfen.`);
    found.push({ name, start, end, date: rowDate || lead ? resolveDate(rowDate, lead?.wd, ctx) : undefined });
  }
  return found;
}

function mergeShifts(list: ParsedShift[]): ParsedShift[] {
  const merged = new Map<string, ParsedShift>();
  for (const s of list) {
    const k = nameKey(s.name);
    const ex = merged.get(k);
    if (ex) {
      ex.start = Math.min(ex.start, s.start);
      ex.end = Math.max(ex.end, s.end);
    } else merged.set(k, { name: s.name, start: s.start, end: s.end });
  }
  return [...merged.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name, 'de'));
}

// ------------------------------------------------------------------ Layout: Tabelle mit Spalte pro Tag
interface Column { x: number; date: string | null }

function isHeaderLine(text: string): { wds: WdTok[]; dates: DateTok[] } | null {
  if (hasTimes(text)) return null;
  const wds = findWeekdays(text);
  const dates = findDates(text);
  return wds.length >= 3 || dates.length >= 3 ? { wds, dates } : null;
}

function parseColumns(lines: PdfLine[], ctx: { year: number; monday: Date | null }, warnings: string[]): ParsedDay[] | null {
  const hi = lines.slice(0, 60).findIndex((l) => isHeaderLine(l.text));
  if (hi < 0) return null;
  const head = lines[hi];
  const h = isHeaderLine(head.text)!;

  // Spaltenpositionen aus Wochentagen oder Daten der Kopfzeile
  const base = h.wds.length >= 3 ? h.wds.map((w) => ({ x: xAt(head, w.idx), wd: w.wd })) : h.dates.map((d) => ({ x: xAt(head, d.idx), wd: -1 }));
  // Datumsangaben in Kopfzeile oder den zwei Zeilen darunter (zweizeiliger Kopf)
  const dateToks: { x: number; tok: DateTok }[] = [];
  for (const l of lines.slice(hi, hi + 3)) {
    if (l !== head && hasTimes(l.text)) break;
    for (const d of findDates(l.text)) dateToks.push({ x: xAt(l, d.idx), tok: d });
  }
  const spacing = base.length > 1 ? (base[base.length - 1].x - base[0].x) / (base.length - 1) : 100;
  const cols: Column[] = base.map((b) => {
    const near = dateToks.filter((d) => Math.abs(d.x - b.x) < spacing * 0.6).sort((a, c) => Math.abs(a.x - b.x) - Math.abs(c.x - b.x))[0];
    return { x: b.x, date: resolveDate(near?.tok, b.wd >= 0 ? b.wd : undefined, ctx) };
  });
  if (cols.some((c) => !c.date)) warnings.push('Nicht alle Wochentage konnten einem Datum zugeordnet werden – bitte Datum je Tag prüfen.');
  const nameBoundary = cols[0].x - spacing * 0.5;
  const nearestCol = (x: number) => cols.reduce((best, c, i) => (Math.abs(c.x - x) < Math.abs(cols[best].x - x) ? i : best), 0);

  const perCol: ParsedShift[][] = cols.map(() => []);
  let lastName: string | null = null;
  let pendingName: string | null = null;
  for (const line of lines.slice(hi + 1)) {
    const text = line.text;
    if (isHeaderLine(text)) continue; // wiederholter Tabellenkopf auf Folgeseiten
    // Name = Text links von der ersten Tagesspalte
    const nameText = line.spans.filter((s) => s.x < nameBoundary).map((s) => text.slice(s.start, s.end)).join(' ');
    const name = cleanName(nameText);

    const ranges: { x: number; start: number; end: number; from: number; to: number }[] = [];
    RANGE_RE.lastIndex = 0;
    for (const m of text.matchAll(RANGE_RE)) {
      const idx = m.index ?? 0;
      if (xAt(line, idx) < nameBoundary) continue;
      ranges.push({ x: xAt(line, idx), start: toMin(m[1], m[2]), end: toMin(m[3], m[4]), from: idx, to: idx + m[0].length });
    }
    const singles = [...text.matchAll(SINGLE_RE)]
      .filter((m) => !ranges.some((r) => (m.index ?? 0) >= r.from && (m.index ?? 0) < r.to) && xAt(line, m.index ?? 0) >= nameBoundary)
      .map((m) => ({ x: xAt(line, m.index ?? 0), t: toMin(m[1], m[2]) }));

    if (ranges.length === 0 && singles.length < 2) {
      if (looksLikeName(name) && !ABSENCE_RE.test(name)) pendingName = name;
      continue;
    }
    const who: string | null = looksLikeName(name) ? name : pendingName ?? lastName;
    pendingName = null;
    if (!who) continue;
    lastName = who;
    for (const r of ranges) perCol[nearestCol(r.x)].push({ name: who, start: r.start, end: r.end });
    // Einzelzeiten je Spalte paarweise (Beginn, Ende)
    const byCol = new Map<number, number[]>();
    for (const s of singles) (byCol.get(nearestCol(s.x)) ?? byCol.set(nearestCol(s.x), []).get(nearestCol(s.x))!).push(s.t);
    for (const [ci, ts] of byCol) for (let i = 0; i + 1 < ts.length; i += 2) perCol[ci].push({ name: who, start: ts[i], end: ts[i + 1] });
  }

  return cols
    .map((c, i) => ({ date: c.date ?? '', shifts: mergeShifts(perCol[i]) }))
    .filter((d) => d.shifts.length > 0);
}

// ------------------------------------------------------------------ Layout: Abschnitt pro Tag / Liste / Einzeltag
function parseSections(lines: PdfLine[], ctx: { year: number; monday: Date | null }, warnings: string[]): { days: ParsedDay[]; undated: ParsedShift[] } {
  const segments: { date: string | null; lines: string[] }[] = [{ date: null, lines: [] }];
  for (const l of lines) {
    const t = l.text;
    const dates = findDates(t);
    const wds = findWeekdays(t);
    const textWithoutTokens = cleanName(t.replace(new RegExp(WD_RE.source, 'g'), ' '));
    const isHeader =
      !hasTimes(t) && !FOOTER_RE.test(t) &&
      ((dates.length === 1) || (dates.length === 0 && wds.length === 1 && !looksLikeName(textWithoutTokens)));
    if (isHeader) {
      const date = resolveDate(dates[0], wds[0]?.wd, ctx);
      if (date) {
        segments.push({ date, lines: [] });
        continue;
      }
    }
    segments[segments.length - 1].lines.push(t);
  }
  // Zeilen vor dem ersten Datum gehören zum ersten Abschnitt
  if (segments.length > 1 && segments[0].lines.length) segments[1].lines.unshift(...segments[0].lines);
  if (segments.length > 1) segments.shift();

  const byDate = new Map<string, ParsedShift[]>();
  const undated: ParsedShift[] = [];
  for (const seg of segments) {
    for (const s of parseRows(seg.lines, ctx, warnings)) {
      const d = s.date ?? seg.date;
      if (d) (byDate.get(d) ?? byDate.set(d, []).get(d)!).push(s);
      else undated.push(s);
    }
  }
  return {
    days: [...byDate.entries()].map(([date, shifts]) => ({ date, shifts: mergeShifts(shifts) })).filter((d) => d.shifts.length),
    undated: mergeShifts(undated),
  };
}

/** Komplettes PDF auswerten: erkennt Wochen-Tabelle, Tagesabschnitte, Listen oder Einzeltag. */
export function parseWeekLines(lines: PdfLine[], ctxOverride?: { year: number; monday: Date | null }): WeekParseResult {
  const warnings: string[] = [];
  const ctx = ctxOverride ?? documentContext(lines);
  const text = lines.map((l) => l.text);

  const colDays = parseColumns(lines, ctx, warnings);
  let result: WeekParseResult;
  if (colDays && colDays.length > 0) {
    result = { layout: 'columns', days: colDays, undated: [], lines: text, warnings };
  } else {
    warnings.length = 0;
    const { days, undated } = parseSections(lines, ctx, warnings);
    result = { layout: days.length > 1 ? 'sections' : 'single', days, undated, lines: text, warnings };
  }
  result.days.sort((a, b) => a.date.localeCompare(b.date));
  if (result.days.length === 0 && result.undated.length === 0) warnings.push('Keine Schichten erkannt. Bitte Mitarbeiter manuell in der Tabelle ergänzen.');
  return result;
}

/** Reine Text-Variante (ein Tag) – z. B. für Tests. */
export function parseShiftText(lines: string[]): ParseResult {
  const r = parseWeekLines(lines.map(plainLine));
  const day = r.days[0];
  return { date: day?.date ?? null, shifts: day?.shifts ?? r.undated, lines: r.lines, warnings: r.warnings };
}

export function parseWeekText(lines: string[]): WeekParseResult {
  return parseWeekLines(lines.map(plainLine));
}

/** Text eines PDFs mit Positionen auslesen. */
export async function extractPdfItems(file: File): Promise<PdfItem[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str });
    }
    pages.push(items);
  }
  return pages;
}

const addDays = (isoDate: string, n: number) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return dateToIso(new Date(y, m - 1, d + n));
};

/**
 * PDF mit mehreren Seiten: Ist jede Seite genau ein Tag (typischer PEPZeit-Wochenausdruck
 * mit 7 Seiten), wird seitenweise ausgewertet. Fehlt auf einer Seite das Datum, wird es aus
 * der Nachbarseite abgeleitet (Vortag + 1). Sonst Auswertung des Gesamtdokuments.
 */
export function parsePdfPages(pages: PdfItem[][]): WeekParseResult {
  const allLines = itemsToLines(pages);
  const whole = parseWeekLines(allLines);
  if (pages.length < 2 || whole.layout === 'columns') return whole;

  const ctx = documentContext(allLines);
  const perPage: { page: number; date: string | null; shifts: ParsedShift[]; warnings: string[] }[] = [];
  for (let i = 0; i < pages.length; i++) {
    const r = parseWeekLines(itemsToLines([pages[i]]), ctx);
    const shifts = [...r.days.flatMap((d) => d.shifts), ...r.undated];
    if (shifts.length === 0) continue; // Deckblatt o. Ä.
    if (r.days.length > 1) return whole; // Seite enthält mehrere Tage → kein Seiten-Layout
    perPage.push({ page: i + 1, date: r.days[0]?.date ?? null, shifts: r.days[0]?.shifts ?? r.undated, warnings: r.warnings.filter((w) => !w.startsWith('Keine Schichten')) });
  }
  if (perPage.length < 2 || perPage.every((p) => !p.date)) return whole;

  const warnings: string[] = [];
  // fehlende Daten aus Nachbarseiten ableiten
  for (let pass = 0; pass < perPage.length; pass++) {
    perPage.forEach((p, i) => {
      if (p.date) return;
      if (perPage[i - 1]?.date) p.date = addDays(perPage[i - 1].date!, 1);
      else if (perPage[i + 1]?.date) p.date = addDays(perPage[i + 1].date!, -1);
      if (p.date) warnings.push(`Seite ${p.page}: kein Datum gefunden – als ${p.date.split('-').reverse().join('.')} angenommen, bitte prüfen.`);
    });
  }
  const byDate = new Map<string, ParsedShift[]>();
  for (const p of perPage) {
    warnings.push(...p.warnings);
    (byDate.get(p.date!) ?? byDate.set(p.date!, []).get(p.date!)!).push(...p.shifts);
  }
  const days = [...byDate.entries()].map(([date, shifts]) => ({ date, shifts: mergeShifts(shifts) })).sort((a, b) => a.date.localeCompare(b.date));
  return { layout: 'pages', days, undated: [], lines: whole.lines, warnings: [...new Set(warnings)] };
}

export async function parsePepzeitPdf(file: File): Promise<WeekParseResult> {
  return parsePdfPages(await extractPdfItems(file));
}
