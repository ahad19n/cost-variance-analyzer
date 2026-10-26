const express = require('express');
const multer = require('multer');
const config = require('../config');
const { q, insertItems } = require('../db');
const { requireAuth, loadOwnedProject } = require('../middleware/auth');
const limits = require('../middleware/rateLimits');
const { projectSchema, itemSchema, idParam, formatIssues } = require('../services/validate');
const { summarize } = require('../services/calc');
const { detectAnomalies } = require('../services/anomaly');
const { parseUpload } = require('../services/parse');
const report = require('../services/report');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(), // never written to disk, never served back
  limits: { fileSize: config.upload.maxBytes, files: 1, fields: 5, parts: 6 },
  fileFilter: (req, file, cb) => cb(null, /\.(csv|xlsx)$/i.test(file.originalname)),
});

const flash = (req, type, text) => { req.session.flash = { type, text }; };

function analyse(project) {
  const summary = summarize(q.itemsForProject.all(project.id));
  const anomalies = detectAnomalies(summary.lines);
  return { summary, anomalies };
}

function safeFilename(name) {
  return (String(name).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'project');
}

// --- Dashboard / projects -------------------------------------------------------

router.get('/', requireAuth, (req, res) => {
  const projects = q.projectsByOwner.all(req.session.userId).map((p) => ({
    ...p,
    variance: p.total_actual - p.total_estimated,
    variancePct: p.total_estimated ? ((p.total_actual - p.total_estimated) / p.total_estimated) * 100 : null,
  }));
  res.render('dashboard', { projects, errors: [] });
});

router.post('/projects', requireAuth, (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) {
    flash(req, 'error', `Project ${formatIssues(parsed.error).join(', ')}`);
    return res.redirect('/');
  }
  const info = q.createProject.run(req.session.userId, parsed.data.name, parsed.data.description);
  return res.redirect(`/projects/${info.lastInsertRowid}`);
});

router.get('/template.csv', requireAuth, (req, res) => {
  res.attachment('cost-template.csv').type('text/csv').send(
    'category,item,estimated,actual,date,notes\n' +
    'Labour,Backend development,12000,13500,2026-01-31,Extra sprint\n' +
    'Software,Cloud hosting,1800,1650,2026-01-31,\n',
  );
});

router.get('/projects/:id', requireAuth, loadOwnedProject, (req, res) => {
  const { summary, anomalies } = analyse(req.project);
  const flagged = new Set(anomalies.map((a) => a.id));
  res.render('project', { project: req.project, summary, anomalies, flagged, maxRows: config.upload.maxRows });
});

router.post('/projects/:id/delete', requireAuth, loadOwnedProject, (req, res) => {
  q.deleteProject.run(req.project.id, req.session.userId);
  flash(req, 'ok', 'Project deleted.');
  res.redirect('/');
});

// --- Line items -------------------------------------------------------------------

router.post('/projects/:id/items', requireAuth, loadOwnedProject, (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) {
    flash(req, 'error', `Item not added: ${formatIssues(parsed.error).join(', ')}`);
  } else {
    insertItems(req.project.id, [parsed.data]);
    flash(req, 'ok', 'Line item added.');
  }
  res.redirect(`/projects/${req.project.id}#items`);
});

router.post('/projects/:id/items/:itemId/delete', requireAuth, loadOwnedProject, (req, res) => {
  const itemId = idParam.safeParse(req.params.itemId);
  if (itemId.success) q.deleteItem.run(itemId.data, req.project.id); // scoped to this (owned) project
  res.redirect(`/projects/${req.project.id}#items`);
});

router.post('/projects/:id/items/clear', requireAuth, loadOwnedProject, (req, res) => {
  q.clearItems.run(req.project.id);
  flash(req, 'ok', 'All line items removed.');
  res.redirect(`/projects/${req.project.id}`);
});

// --- Upload: parse + preview, then commit -------------------------------------------

router.post('/projects/:id/upload', requireAuth, limits.upload, loadOwnedProject, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(415).json({ error: 'Only .csv and .xlsx files (max 2 MB) are accepted.' });
    const { rows, errors } = await parseUpload(req.file);
    req.session.pendingUpload = { projectId: req.project.id, rows };
    return res.json({
      filename: req.file.originalname.slice(0, 100),
      validCount: rows.length,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      preview: summarize(rows.slice(0, 20)).lines,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/projects/:id/upload/commit', requireAuth, loadOwnedProject, (req, res) => {
  const pending = req.session.pendingUpload;
  if (!pending || pending.projectId !== req.project.id || !pending.rows.length) {
    return res.status(400).json({ error: 'No pending upload for this project.' });
  }
  if (req.body?.mode === 'replace') q.clearItems.run(req.project.id);
  insertItems(req.project.id, pending.rows);
  delete req.session.pendingUpload;
  flash(req, 'ok', `Imported ${pending.rows.length} line items.`);
  return res.json({ ok: true, imported: pending.rows.length });
});

// --- Data for charts -------------------------------------------------------------------

router.get('/projects/:id/data.json', requireAuth, loadOwnedProject, (req, res) => {
  const { summary, anomalies } = analyse(req.project);
  res.json({ byCategory: summary.byCategory, lines: summary.lines, totals: summary.totals, anomalies });
});

// --- Reports -----------------------------------------------------------------------------

function sendPdf(req, res) {
  const { summary, anomalies } = analyse(req.project);
  const ai = req.project.ai_summary ? JSON.parse(req.project.ai_summary) : null;
  const charts = report.decodeChartImages(req.body?.charts);
  res.attachment(`${safeFilename(req.project.name)}-cost-report.pdf`).type('application/pdf');
  report.pdfReport(req.project, summary, anomalies, ai, charts).pipe(res);
}

router.get('/projects/:id/report.pdf', requireAuth, limits.report, loadOwnedProject, sendPdf);
router.post('/projects/:id/report.pdf', requireAuth, limits.report, loadOwnedProject, sendPdf);

router.get('/projects/:id/report.xlsx', requireAuth, limits.report, loadOwnedProject, async (req, res, next) => {
  try {
    const { summary, anomalies } = analyse(req.project);
    const buf = await report.xlsxReport(req.project, summary, anomalies);
    res.attachment(`${safeFilename(req.project.name)}-cost-report.xlsx`).send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.get('/projects/:id/report.csv', requireAuth, limits.report, loadOwnedProject, (req, res) => {
  const { summary } = analyse(req.project);
  res.attachment(`${safeFilename(req.project.name)}-line-items.csv`).type('text/csv').send(report.csvReport(summary));
});

module.exports = router;
