const { z } = require('zod');

// Strip ASCII control characters (keeps \t \n) and trim.
const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

const text = (max) => z.preprocess(clean, z.string().max(max));
const requiredText = (max) => z.preprocess(clean, z.string().min(1, 'is required').max(max));

// Accepts "1,234.50", "$1200", " 99 " etc. Rejects anything else.
const money = z.preprocess((v) => {
  if (typeof v === 'number') return v;
  const s = clean(v).replace(/[$£€,\s]/g, '');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}, z.number({ error: 'must be a number' }).finite().min(0, 'cannot be negative').max(1e12, 'is too large'));

const isoDate = z.preprocess((v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = clean(v);
  return s === '' ? null : s;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').nullable());

const itemSchema = z.object({
  category: requiredText(60),
  item: requiredText(120),
  estimated: money,
  actual: money,
  date: isoDate.optional().default(null),
  notes: text(500).optional().default(''),
});

const projectSchema = z.object({
  name: requiredText(100),
  description: text(500).optional().default(''),
});

const credentialsSchema = z.object({
  username: z.preprocess(clean, z.string().regex(/^[A-Za-z0-9_.-]{3,32}$/, 'must be 3-32 letters, digits, _ . -')),
  password: z.string().min(8, 'must be at least 8 characters').max(128),
});

const idParam = z.coerce.number().int().positive();

function formatIssues(error) {
  return error.issues.map((i) => `${i.path.join('.') || 'value'} ${i.message}`);
}

module.exports = { itemSchema, projectSchema, credentialsSchema, idParam, formatIssues, clean };
