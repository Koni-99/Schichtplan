import type { DailyPlan, PauseBlock, Settings, ShiftEntry } from './types';
import { SHIFT_STATUS_LABEL } from './types';
import { diffPlan, DEVIATION_LABEL, type ShiftDiff } from './diff';
import { fmtDate, fmtMin, isoWeek } from './time';

export interface ReportDay {
  plan: DailyPlan;
  shifts: ShiftEntry[];
  pauses: PauseBlock[];
}

function blocksText(d: ShiftDiff): string {
  return d.blocks
    .filter((b) => b.status !== 'cancelled')
    .map((b) => {
      const ist = b.status === 'done' ? `${b.actual_duration_min ?? b.planned_duration_min}` : b.status === 'running' ? 'läuft' : 'nicht genommen';
      return `B${b.block_no} ${fmtMin(b.start_min)} ${b.planned_duration_min}/${ist}`;
    })
    .join(', ');
}

function rowsFor(days: ReportDay[], cfg: Settings) {
  return days.flatMap(({ plan, shifts, pauses }) =>
    diffPlan(plan, shifts, pauses, cfg).map((d) => ({ plan, d })),
  );
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV mit Semikolon + UTF-8-BOM → öffnet sich in deutschem Excel direkt korrekt. */
export function buildCsv(days: ReportDay[], cfg: Settings): string {
  const head = ['Datum', 'KW', 'Mitarbeiter', 'Status', 'Soll Beginn', 'Soll Ende', 'Ist Beginn', 'Ist Ende', 'Soll Pause (Min.)', 'Ist Pause (Min.)', 'Soll Arbeitszeit (Min.)', 'Ist Arbeitszeit (Min.)', 'Abweichungen', 'Manuell ergänzt', 'Notiz', 'Pausenblöcke (Start Soll/Ist)', 'Abschluss'];
  const lines = [head.join(';')];
  for (const { plan, d } of rowsFor(days, cfg)) {
    lines.push(
      [
        fmtDate(plan.plan_date, { day: '2-digit', month: '2-digit', year: 'numeric' }),
        isoWeek(plan.plan_date).week,
        d.shift.employee_name,
        SHIFT_STATUS_LABEL[d.shift.status],
        fmtMin(d.sollStart),
        fmtMin(d.sollEnd),
        fmtMin(d.istStart),
        fmtMin(d.istEnd),
        d.sollPause,
        d.istPause,
        d.sollWork,
        d.istWork,
        d.kinds.map((k) => DEVIATION_LABEL[k]).join(', '),
        d.shift.is_manual ? 'ja' : 'nein',
        d.shift.note,
        blocksText(d),
        plan.closed_label ?? (plan.closed_type === 'manual' ? 'Manuell abgeschlossen' : plan.status === 'open' ? 'Offen' : ''),
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  return '﻿' + lines.join('\r\n');
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportCsv(days: ReportDay[], cfg: Settings, filename: string) {
  downloadBlob(buildCsv(days, cfg), filename, 'text/csv;charset=utf-8');
}

/** Druckfertiger PDF-Nachweis (Querformat), Abweichungen farbig markiert. */
export async function exportPdf(days: ReportDay[], cfg: Settings, title: string, filename: string) {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const sorted = [...days].sort((a, b) => a.plan.plan_date.localeCompare(b.plan.plan_date));

  sorted.forEach(({ plan, shifts, pauses }, idx) => {
    if (idx > 0) doc.addPage();
    const diffs = diffPlan(plan, shifts, pauses, cfg);
    doc.setFontSize(15);
    doc.text(`${title}`, 12, 14);
    doc.setFontSize(11);
    doc.text(`${fmtDate(plan.plan_date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} · KW ${isoWeek(plan.plan_date).week}`, 12, 21);
    doc.setFontSize(9);
    const closed = plan.closed_at ? `${plan.closed_label ?? (plan.closed_type === 'auto' ? 'Automatisch abgeschlossen' : 'Manuell abgeschlossen')} (${new Date(plan.closed_at).toLocaleString('de-DE')})` : 'Noch nicht abgeschlossen';
    doc.text(`${closed} · ${diffs.filter((d) => d.kinds.length).length} Mitarbeiter mit Abweichungen`, 12, 26);

    autoTable(doc, {
      startY: 30,
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [124, 45, 18] },
      head: [['Mitarbeiter', 'Status', 'Soll', 'Ist', 'Pause Soll', 'Pause Ist', 'Abweichungen / Notiz', 'Pausenblöcke']],
      body: diffs.map((d) => [
        d.shift.employee_name + (d.shift.is_manual ? ' (manuell)' : ''),
        SHIFT_STATUS_LABEL[d.shift.status],
        d.sollStart != null ? `${fmtMin(d.sollStart)}–${fmtMin(d.sollEnd)}` : '–',
        d.istStart != null ? `${fmtMin(d.istStart)}–${fmtMin(d.istEnd)}` : '–',
        `${d.sollPause} Min.`,
        `${d.istPause} Min.`,
        d.summary.join('\n') || 'keine',
        blocksText(d),
      ]),
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const d = diffs[data.row.index];
        if (d.kinds.includes('sick') || d.kinds.includes('absent')) data.cell.styles.fillColor = [254, 226, 226];
        else if (d.kinds.length) data.cell.styles.fillColor = [255, 237, 213];
      },
      margin: { left: 12, right: 12 },
    });
    doc.setFontSize(8);
    doc.text(`Erstellt ${new Date().toLocaleString('de-DE')} · Seite ${idx + 1}/${sorted.length}`, 12, doc.internal.pageSize.getHeight() - 6);
  });
  doc.save(filename);
}
