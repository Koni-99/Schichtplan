import type { Minutes } from './types';
import { nameKey, pad } from './time';

export interface ParsedShift {
  name: string;
  start: Minutes;
  end: Minutes;
}

export interface ParseResult {
  date: string | null; // YYYY-MM-DD
  shifts: ParsedShift[];
  lines: string[];
  warnings: string[];
}

const TIME = String.raw`([01]?\d|2[0-4])[:.]([0-5]\d)`;
const RANGE_RE = new RegExp(String.raw`${TIME}\s*(?:Uhr)?\s*(?:-|–|—|bis)\s*${TIME}`, 'gi');
const SINGLE_RE = new RegExp(String.raw`(?<![\d.])${TIME}(?![\d.])`, 'g');
const DATE_RE = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?!\d)/;

/** Wörter, die keine Mitarbeiternamen sind (Kopf-/Fußzeilen, Spaltentitel). */
const STOP_WORDS = [
  'datum', 'mitarbeiter', 'name', 'summe', 'gesamt', 'filiale', 'seite', 'schichtplan', 'dienstplan', 'pepzeit', 'woche',
  'kw', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag', 'beginn', 'ende', 'pause', 'stunden',
  'gedruckt', 'erstellt', 'stand', 'planung', 'abteilung', 'kostenstelle', 'von', 'bis', 'uhrzeit', 'zeit', 'soll', 'ist',
];

const toMin = (h: string, m: string) => Number(h) * 60 + Number(m);

function cleanName(raw: string): string {
  return raw
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

function parseDate(lines: string[]): string | null {
  for (const l of lines) {
    const m = l.match(DATE_RE);
    if (m) {
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      const mo = Number(m[2]), d = Number(m[1]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
    }
  }
  return null;
}

/**
 * Reine Text-Heuristik für PEPZeit-Tagespläne (testbar ohne PDF):
 * Jede Zeile mit Name + Zeitspanne ("Müller, Anna 05:30 - 14:00") wird zu einer Schicht.
 * Unterstützt auch zwei Einzelzeiten ohne Bindestrich und Namen in der Vorzeile.
 * Mehrfachnennungen desselben Namens werden zusammengeführt (früheste Beginn, späteste Ende).
 */
export function parseShiftText(lines: string[]): ParseResult {
  const warnings: string[] = [];
  const found: ParsedShift[] = [];
  let pendingName: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
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
      pendingName = looksLikeName(n) ? n : null;
      continue;
    }

    let name = cleanName(lineNoDate.slice(0, firstIdx));
    if (!looksLikeName(name)) {
      // Name evtl. hinter den Zeiten oder in der Vorzeile
      const after = cleanName(lineNoDate.slice(firstIdx).replace(RANGE_RE, ' ').replace(SINGLE_RE, ' '));
      if (looksLikeName(after)) name = after;
      else if (pendingName) name = pendingName;
      else continue;
    }
    pendingName = null;

    if (end <= start) {
      warnings.push(`${name}: Ende (${pad(Math.floor(end / 60))}:${pad(end % 60)}) liegt vor Beginn – bitte prüfen.`);
    }
    if (start < 4 * 60 || end > 22 * 60) warnings.push(`${name}: ungewöhnliche Uhrzeit – bitte prüfen.`);
    found.push({ name, start, end });
  }

  // zusammenführen
  const merged = new Map<string, ParsedShift>();
  for (const s of found) {
    const k = nameKey(s.name);
    const ex = merged.get(k);
    if (ex) {
      ex.start = Math.min(ex.start, s.start);
      ex.end = Math.max(ex.end, s.end);
    } else merged.set(k, { ...s });
  }
  const shifts = [...merged.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name, 'de'));
  if (shifts.length === 0) warnings.push('Keine Schichten erkannt. Bitte Mitarbeiter manuell in der Tabelle ergänzen.');
  return { date: parseDate(lines), shifts, lines, warnings };
}

/** Text aus einem PDF zeilenweise extrahieren (Positionen → Zeilen, links nach rechts). */
export async function extractPdfLines(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: { x: number; y: number; w: number; s: string }[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str });
    }
    // nach y gruppieren (Toleranz 3pt), dann nach x sortieren
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: (typeof items)[] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= 3);
      if (row) row.push(it);
      else rows.push([it]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      let line = '';
      let lastEnd = -Infinity;
      for (const it of row) {
        line += (line && it.x - lastEnd > 1 ? ' ' : '') + it.s;
        lastEnd = it.x + it.w;
      }
      out.push(line);
    }
  }
  return out;
}

export async function parsePepzeitPdf(file: File): Promise<ParseResult> {
  return parseShiftText(await extractPdfLines(file));
}
