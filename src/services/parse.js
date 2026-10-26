// Parsing and validation of uploaded CSV / XLSX cost sheets.
// Defence in depth: extension allow-list -> magic-byte sniffing -> zip-bomb check (xlsx)
// -> header allow-list -> per-row schema validation -> row cap.

const Papa = require('papaparse');
const ExcelJS = require('exceljs');
const config = require('../config');
const { itemSchema, formatIssues } = require('./validate');

class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

const HEADER_ALIASES = {
  category: ['category', 'cost category', 'type'],
  item: ['item', 'description', 'line item', 'name'],
  estimated: ['estimated', 'estimated cost', 'estimate', 'budget', 'planned'],
  actual: ['actual', 'actual cost', 'spent', 'actuals'],
  date: ['date'],
  notes: ['notes', 'note', 'comments', 'comment'],
};
const REQUIRED = ['category', 'item', 'estimated', 'actual'];

function canonicalHeader(h) {
  const k = String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [canon, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(k)) return canon;
  }
  return null; // unknown columns are ignored
}

// --- File type sniffing ----------------------------------------------------

const isZip = (buf) => buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;

function looksLikeText(buf) {
  if (buf.includes(0)) return false; // NUL bytes => binary
  const sample = buf.subarray(0, 8192);
  const str = sample.toString('utf8');
  if (str.includes('�')) return false; // invalid UTF-8
  // eslint-disable-next-line no-control-regex
  const ctrl = (str.match(/[\u0001-\u0008\u000E-\u001F]/g) || []).length;
  return ctrl / Math.max(str.length, 1) < 0.01;
}

// Inspect the ZIP central directory *without* decompressing, so a small upload cannot
// expand into gigabytes of XML ("zip bomb") once ExcelJS opens it.
const MAX_UNCOMPRESSED = 25 * 1024 * 1024;
const MAX_RATIO = 100;
const MAX_ENTRIES = 200;

function checkZipBomb(buf) {
  const minEocd = 22;
  const searchStart = Math.max(0, buf.length - (0xffff + minEocd));
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new UploadError('Corrupt XLSX file (no ZIP directory)');

  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries > MAX_ENTRIES) throw new UploadError('XLSX file has too many internal parts');
  if (entries === 0xffff || cdOffset === 0xffffffff) throw new UploadError('ZIP64 workbooks are not supported');

  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new UploadError('Corrupt XLSX file (bad ZIP entry)');
    }
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    total += uncompressed;
    if (compressed > 0 && uncompressed / compressed > MAX_RATIO && uncompressed > 1024 * 1024) {
      throw new UploadError('XLSX file rejected: suspicious compression ratio (possible zip bomb)');
    }
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  if (total > MAX_UNCOMPRESSED) throw new UploadError('XLSX file rejected: expands beyond 25 MB');
}

// --- Raw row extraction ----------------------------------------------------

function parseCsv(buf) {
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const res = Papa.parse(text, { skipEmptyLines: 'greedy' });
  if (res.errors.length && !res.data.length) throw new UploadError('Could not parse CSV file');
  return res.data;
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result); // formula: use the cached result, never the formula
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text; // hyperlink
    if ('error' in v) return '';
    return '';
  }
  return v;
}

async function parseXlsx(buf) {
  checkZipBomb(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new UploadError('Could not read XLSX workbook');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new UploadError('Workbook has no worksheets');
  if (ws.rowCount > config.upload.maxRows + 1) {
    throw new UploadError(`Too many rows (max ${config.upload.maxRows})`);
  }
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let c = 1; c <= Math.min(row.cellCount, 50); c++) vals.push(cellValue(row.getCell(c).value));
    rows.push(vals);
  });
  return rows;
}

// --- Public API --------------------------------------------------------------

async function parseUpload(file) {
  if (!file || !file.buffer || file.size === 0) throw new UploadError('No file uploaded or file is empty');

  const ext = (file.originalname.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
  let raw;
  if (ext === 'csv') {
    if (!looksLikeText(file.buffer)) {
      throw new UploadError('File content is not a text CSV (binary data detected)', 415);
    }
    raw = parseCsv(file.buffer);
  } else if (ext === 'xlsx') {
    if (!isZip(file.buffer)) throw new UploadError('File content is not a valid XLSX workbook', 415);
    raw = await parseXlsx(file.buffer);
  } else {
    throw new UploadError('Only .csv and .xlsx files are accepted', 415);
  }

  if (raw.length < 2) throw new UploadError('File must contain a header row and at least one data row');
  if (raw.length - 1 > config.upload.maxRows) {
    throw new UploadError(`Too many rows (max ${config.upload.maxRows})`);
  }

  const headers = raw[0].map(canonicalHeader);
  const missing = REQUIRED.filter((r) => !headers.includes(r));
  if (missing.length) {
    throw new UploadError(`Missing required column(s): ${missing.join(', ')}. Expected: category, item, estimated, actual [, date, notes]`);
  }

  const rows = [];
  const errors = [];
  raw.slice(1).forEach((vals, i) => {
    const obj = {};
    headers.forEach((h, c) => {
      if (h && !(h in obj)) obj[h] = vals[c];
    });
    const r = itemSchema.safeParse(obj);
    if (r.success) rows.push(r.data);
    else errors.push({ row: i + 2, issues: formatIssues(r.error) });
  });

  return { rows, errors };
}

module.exports = { parseUpload, UploadError, checkZipBomb, looksLikeText };
