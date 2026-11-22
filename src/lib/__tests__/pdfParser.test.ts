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
