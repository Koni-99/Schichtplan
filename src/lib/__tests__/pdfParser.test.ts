import { describe, expect, it } from 'vitest';
import { parseShiftText } from '../pdfParser';

describe('parseShiftText', () => {
  it('erkennt Datum, Namen und Zeitspannen', () => {
    const r = parseShiftText([
      'PEPZeit Tagesplan Filiale 12 Seite 1',
      'Datum: Mo, 23.11.2026',
      'Nr Mitarbeiter Beginn Ende',
      '1012 Müller, Anna 05:30 - 14:00',
      '1013 Schmidt, Bernd 06:00 – 14:30 Uhr',
      'Yilmaz Ayse 11.00 bis 19.30',
      'Lehmann, Tom',
      '13:00 20:00',
      'Summe 4 Mitarbeiter 32:00',
    ]);
    expect(r.date).toBe('2026-11-23');
    expect(r.shifts.map((s) => s.name)).toEqual(['Müller, Anna', 'Schmidt, Bernd', 'Yilmaz Ayse', 'Lehmann, Tom']);
    expect(r.shifts[0]).toMatchObject({ start: 330, end: 840 });
    expect(r.shifts[2]).toMatchObject({ start: 660, end: 1170 });
    expect(r.shifts[3]).toMatchObject({ start: 780, end: 1200 });
  });

  it('führt geteilte Schichten zusammen', () => {
    const r = parseShiftText(['Anna Müller 06:00-10:00', 'Müller Anna 12:00-16:00']);
    expect(r.shifts).toHaveLength(1);
    expect(r.shifts[0]).toMatchObject({ start: 360, end: 960 });
  });
});

import { itemsToLines, parseWeekLines, parseWeekText, type PdfItem } from '../pdfParser';

describe('Wochen-PDF', () => {
  it('Abschnitt pro Tag', () => {
    const r = parseWeekText([
      'PEPZeit Wochenplan Filiale 12 · KW 48/2026',
      'Montag, 23.11.2026',
      'Müller, Anna 05:30 - 14:00',
      'Schmidt, Bernd 06:00 - 14:30',
      'Dienstag, 24.11.2026',
      'Müller, Anna 11:00 - 19:30',
      'Donnerstag, 26.11.',
      'Yilmaz, Ayse 06:00 - 12:00',
      'Gedruckt am 20.11.2026 10:15',
    ]);
    expect(r.layout).toBe('sections');
    expect(r.days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-26']);
    expect(r.days[0].shifts).toHaveLength(2);
    expect(r.days[1].shifts[0]).toMatchObject({ name: 'Müller, Anna', start: 660, end: 1170 });
  });

  it('Liste mit Wochentag/Datum pro Zeile', () => {
    const r = parseWeekText([
      'Wochenplan 23.11.2026 – 29.11.2026',
      'Mo 23.11. Müller, Anna 05:30-14:00',
      'Mo 23.11. Schmidt, Bernd 06:00-14:30',
      'Fr 27.11. Müller, Anna 12:00-20:00',
    ]);
    expect(r.days.map((d) => [d.date, d.shifts.length])).toEqual([['2026-11-23', 2], ['2026-11-27', 1]]);
    expect(r.days[0].shifts.map((s) => s.name)).toEqual(['Müller, Anna', 'Schmidt, Bernd']);
  });

  it('Tabelle mit einer Spalte pro Wochentag', () => {
    const cols = [150, 230, 310, 390, 470, 550, 630];
    const items: PdfItem[] = [
      { x: 20, y: 800, w: 200, s: 'Wochenplan KW 48 / 2026' },
      { x: 20, y: 780, w: 60, s: 'Mitarbeiter' },
      ...['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((s, i) => ({ x: cols[i], y: 780, w: 14, s })),
      ...['23.11.', '24.11.', '25.11.', '26.11.', '27.11.', '28.11.', '29.11.'].map((s, i) => ({ x: cols[i], y: 768, w: 30, s })),
      { x: 20, y: 750, w: 70, s: 'Müller, Anna' },
      { x: cols[0], y: 750, w: 60, s: '05:30-14:00' },
      { x: cols[1], y: 750, w: 20, s: 'frei' },
      { x: cols[3], y: 750, w: 60, s: '11:00-19:30' },
      { x: 20, y: 735, w: 70, s: 'Schmidt, Bernd' },
      { x: cols[0], y: 735, w: 28, s: '06:00' },
      { x: cols[0] + 32, y: 735, w: 28, s: '14:30' },
      { x: cols[5], y: 735, w: 60, s: '07:00 - 13:00' },
    ];
    const r = parseWeekLines(itemsToLines([items]));
    expect(r.layout).toBe('columns');
    expect(r.days.map((d) => [d.date, d.shifts.map((s) => `${s.name} ${s.start}-${s.end}`)])).toEqual([
      ['2026-11-23', ['Müller, Anna 330-840', 'Schmidt, Bernd 360-870']],
      ['2026-11-26', ['Müller, Anna 660-1170']],
      ['2026-11-28', ['Schmidt, Bernd 420-780']],
    ]);
  });

  it('Tabelle nur mit Wochentagen + KW leitet Daten ab', () => {
    const cols = [150, 230, 310];
    const items: PdfItem[] = [
      { x: 20, y: 800, w: 100, s: 'KW 48 2026' },
      ...['Montag', 'Dienstag', 'Mittwoch'].map((s, i) => ({ x: cols[i], y: 780, w: 40, s })),
      { x: 20, y: 750, w: 70, s: 'Weber, Clara' },
      { x: cols[2], y: 750, w: 60, s: '08:00-16:30' },
    ];
    const r = parseWeekLines(itemsToLines([items]));
    expect(r.days).toEqual([{ date: '2026-11-25', shifts: [{ name: 'Weber, Clara', start: 480, end: 990 }] }]);
  });
});

import { parsePdfPages } from '../pdfParser';

describe('7 Seiten – ein Tag pro Seite', () => {
  const page = (header: string | null, rows: [string, string][]): PdfItem[] => [
    { x: 20, y: 800, w: 300, s: 'PEPZeit Tagesplan Filiale Hauptstraße' },
    ...(header ? [{ x: 20, y: 785, w: 200, s: header }] : []),
    ...rows.flatMap(([n, t], i) => [{ x: 40, y: 760 - i * 12, w: 80, s: n }, { x: 200, y: 760 - i * 12, w: 60, s: t }]),
    { x: 20, y: 40, w: 200, s: 'Gedruckt am 20.11.2026 10:15' },
  ];
  it('ordnet jede Seite einem Tag zu und leitet fehlende Daten ab', () => {
    const pages = [
      page('Montag, 23.11.2026', [['Müller, Anna', '05:30 - 14:00'], ['Schmidt, Bernd', '06:00 - 14:30']]),
      page('Dienstag, 24.11.2026', [['Müller, Anna', '11:00 - 19:30']]),
      page(null, [['Yilmaz, Ayse', '06:00 - 12:00']]), // Datum unleserlich
      page('Donnerstag, 26.11.2026', [['Weber, Clara', '07:00 - 15:30']]),
    ];
    const r = parsePdfPages(pages);
    expect(r.layout).toBe('pages');
    expect(r.days.map((d) => [d.date, d.shifts.length])).toEqual([['2026-11-23', 2], ['2026-11-24', 1], ['2026-11-25', 1], ['2026-11-26', 1]]);
    expect(r.warnings.some((w) => w.includes('Seite 3') && w.includes('25.11.2026'))).toBe(true);
  });
});
