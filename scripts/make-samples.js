// Builds sample-data/valid.xlsx from valid.csv (so the Excel path can be demonstrated).
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const ExcelJS = require('exceljs');

(async () => {
  const dir = path.join(__dirname, '..', 'sample-data');
  const { data } = Papa.parse(fs.readFileSync(path.join(dir, 'valid.csv'), 'utf8'), { skipEmptyLines: true });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Costs');
  ws.addRow(['Category', 'Item', 'Estimated Cost', 'Actual Cost', 'Date', 'Notes']).font = { bold: true };
  for (const r of data.slice(1)) ws.addRow([r[0], r[1], Number(r[2]), Number(r[3]), r[4] ? new Date(`${r[4]}T00:00:00Z`) : null, r[5]]);
  ws.columns.forEach((c, i) => { c.width = [14, 30, 15, 15, 12, 36][i]; });
  await wb.xlsx.writeFile(path.join(dir, 'valid.xlsx'));
  console.log('wrote sample-data/valid.xlsx');
})();
