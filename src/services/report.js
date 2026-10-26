// Downloadable reports: PDF (pdfkit), XLSX and CSV.
// Every exported text cell is passed through neutralizeFormula() so that a value such as
// =HYPERLINK("http://evil","click") is shown as text instead of executing in Excel.

const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');

function neutralizeFormula(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

const fmt = (n) => (n === null || n === undefined ? 'n/a' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (p) => (p === null ? 'n/a' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);

const LINE_COLUMNS = ['Category', 'Item', 'Estimated', 'Actual', 'Variance', 'Variance %', 'Status', 'Date', 'Notes'];
const lineRow = (l) => [l.category, l.item, l.estimated, l.actual, l.variance, l.variancePct, l.status, l.date || '', l.notes || ''];

// --- Chart images posted by the browser -------------------------------------

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_CHART_BYTES = 1024 * 1024;

function decodeChartImages(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 4).flatMap((item) => {
    if (!item || typeof item.data !== 'string') return [];
    const m = item.data.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return [];
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_CHART_BYTES || !buf.subarray(0, 8).equals(PNG_SIG)) return [];
    return [{ title: String(item.title || 'Chart').slice(0, 80), buf }];
  });
}

// --- PDF ---------------------------------------------------------------------

function pdfReport(project, summary, anomalies, aiSummary, charts = []) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Cost report - ${project.name}` } });
  const W = doc.page.width - 80;
  const C = { ink: '#1f2937', muted: '#6b7280', over: '#b91c1c', under: '#047857', rule: '#e5e7eb', head: '#f3f4f6' };

  const heading = (t) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.8).fillColor(C.ink).font('Helvetica-Bold').fontSize(13).text(t, 40);
    doc.moveDown(0.3);
  };

  function table(cols, rows, widths, { colorCol } = {}) {
    const rowH = 16;
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(40, y, W, rowH).fill(C.head);
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(8);
      let x = 40;
      cols.forEach((c, i) => { doc.text(c, x + 3, y + 4, { width: widths[i] - 6, lineBreak: false, ellipsis: true }); x += widths[i]; });
      doc.y = y + rowH;
    };
    drawHeader();
    doc.font('Helvetica').fontSize(8);
    for (const r of rows) {
      if (doc.y > doc.page.height - 60) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(8); }
      const y = doc.y;
      let x = 40;
      r.forEach((cell, i) => {
        let color = C.ink;
        if (i === colorCol && typeof cell === 'string') color = cell.startsWith('+') ? C.over : cell.startsWith('-') ? C.under : C.ink;
        doc.fillColor(color).text(String(cell), x + 3, y + 4, { width: widths[i] - 6, lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.moveTo(40, y + rowH).lineTo(40 + W, y + rowH).strokeColor(C.rule).lineWidth(0.5).stroke();
      doc.y = y + rowH;
    }
    doc.x = 40;
  }

  // Title
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(20).text('Cost Variance Report');
  doc.font('Helvetica').fontSize(11).fillColor(C.muted).text(project.name);
  if (project.description) doc.fontSize(9).text(project.description);
  doc.fontSize(8).text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`);

  // Totals tiles
  const t = summary.totals;
  const tiles = [
    ['Estimated', fmt(t.estimated)],
    ['Actual', fmt(t.actual)],
    ['Variance', `${t.variance > 0 ? '+' : ''}${fmt(t.variance)}`],
    ['Variance %', pct(t.variancePct)],
  ];
  doc.moveDown(1);
  const ty = doc.y;
  const tw = W / 4;
  tiles.forEach(([k, v], i) => {
    const x = 40 + i * tw;
    doc.roundedRect(x + 2, ty, tw - 4, 46, 4).strokeColor(C.rule).lineWidth(1).stroke();
    doc.fillColor(C.muted).font('Helvetica').fontSize(8).text(k, x + 10, ty + 8);
    const col = i >= 2 ? (t.variance > 0 ? C.over : t.variance < 0 ? C.under : C.ink) : C.ink;
    doc.fillColor(col).font('Helvetica-Bold').fontSize(13).text(v, x + 10, ty + 22, { width: tw - 20 });
  });
  doc.y = ty + 56;
  doc.x = 40;
  doc.fillColor(C.muted).font('Helvetica').fontSize(8)
    .text(`${t.count} items: ${summary.counts.over} over budget, ${summary.counts.onBudget} on budget (within 5%), ${summary.counts.under} under budget.`);

  heading('AI cost analysis');
  doc.fillColor(C.ink).font('Helvetica').fontSize(9).text(aiSummary?.text || 'No summary generated yet.', { width: W });
  if (aiSummary?.source) {
    doc.moveDown(0.3).fillColor(C.muted).fontSize(7)
      .text(aiSummary.source === 'ai' ? `Generated by AI model ${aiSummary.model || ''}. Verify before relying on it.` : aiSummary.note || 'Rule-based summary.');
  }

  heading('By category');
  table(['Category', 'Items', 'Estimated', 'Actual', 'Variance', 'Variance %'],
    summary.byCategory.map((c) => [c.category, c.count, fmt(c.estimated), fmt(c.actual), fmt(c.variance), pct(c.variancePct)]),
    [W * 0.3, W * 0.08, W * 0.16, W * 0.16, W * 0.16, W * 0.14], { colorCol: 5 });

  heading(`Unusual expenses (${anomalies.length})`);
  if (!anomalies.length) doc.font('Helvetica').fontSize(9).fillColor(C.ink).text('No unusual expenses detected.');
  for (const a of anomalies) {
    if (doc.y > doc.page.height - 60) doc.addPage();
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9).text(`${a.item} (${a.category})`, { continued: true })
      .font('Helvetica').text(`  est ${fmt(a.estimated)} / act ${fmt(a.actual)} / ${pct(a.variancePct)}`);
    doc.fillColor(C.muted).fontSize(8).text(a.reasons.join('; '), { indent: 10 });
  }

  for (const ch of charts) {
    if (doc.y > doc.page.height - 300) doc.addPage();
    heading(ch.title);
    try {
      doc.image(ch.buf, 40, doc.y, { fit: [W, 240], align: 'center' });
      doc.y += 250;
    } catch {
      doc.font('Helvetica').fontSize(8).text('(chart image could not be embedded)');
    }
  }

  heading('Line items');
  table(['Category', 'Item', 'Estimated', 'Actual', 'Variance', 'Var %', 'Status'],
    summary.lines.map((l) => [l.category, l.item, fmt(l.estimated), fmt(l.actual), fmt(l.variance), pct(l.variancePct), l.status]),
    [W * 0.17, W * 0.27, W * 0.12, W * 0.12, W * 0.12, W * 0.09, W * 0.11], { colorCol: 5 });

  doc.end();
  return doc;
}

// --- XLSX / CSV ----------------------------------------------------------------

async function xlsxReport(project, summary, anomalies) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cost Variance Analyzer';

  const s = wb.addWorksheet('Summary');
  s.addRow(['Project', neutralizeFormula(project.name)]);
  s.addRow(['Total estimated', summary.totals.estimated]);
  s.addRow(['Total actual', summary.totals.actual]);
  s.addRow(['Variance', summary.totals.variance]);
  s.addRow(['Variance %', summary.totals.variancePct]);
  s.addRow([]);
  s.addRow(['Category', 'Items', 'Estimated', 'Actual', 'Variance', 'Variance %']).font = { bold: true };
  for (const c of summary.byCategory) {
    s.addRow([neutralizeFormula(c.category), c.count, c.estimated, c.actual, c.variance, c.variancePct]);
  }
  s.getColumn(1).width = 24;

  const li = wb.addWorksheet('Line items');
  li.addRow(LINE_COLUMNS).font = { bold: true };
  for (const l of summary.lines) li.addRow(lineRow(l).map(neutralizeFormula));
  li.columns.forEach((c, i) => { c.width = [16, 30, 12, 12, 12, 11, 10, 12, 30][i]; });
  ['C', 'D', 'E'].forEach((k) => { li.getColumn(k).numFmt = '#,##0.00'; });

  const an = wb.addWorksheet('Unusual expenses');
  an.addRow(['Category', 'Item', 'Estimated', 'Actual', 'Variance %', 'Reasons']).font = { bold: true };
  for (const a of anomalies) {
    an.addRow([a.category, a.item, a.estimated, a.actual, a.variancePct, a.reasons.join('; ')].map(neutralizeFormula));
  }

  return wb.xlsx.writeBuffer();
}

function csvReport(summary) {
  return Papa.unparse({
    fields: LINE_COLUMNS,
    data: summary.lines.map((l) => lineRow(l).map(neutralizeFormula)),
  });
}

module.exports = { pdfReport, xlsxReport, csvReport, neutralizeFormula, decodeChartImages };
