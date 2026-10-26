const express = require('express');
const { q } = require('../db');
const { requireAuth, loadOwnedProject } = require('../middleware/auth');
const limits = require('../middleware/rateLimits');
const { summarize } = require('../services/calc');
const { detectAnomalies } = require('../services/anomaly');
const { generateSummary } = require('../services/llm');

const router = express.Router();

router.get('/projects/:id/anomalies', requireAuth, loadOwnedProject, (req, res) => {
  const summary = summarize(q.itemsForProject.all(req.project.id));
  res.json({ anomalies: detectAnomalies(summary.lines) });
});

router.post('/projects/:id/summary', requireAuth, limits.ai, loadOwnedProject, async (req, res, next) => {
  try {
    const summary = summarize(q.itemsForProject.all(req.project.id));
    if (!summary.totals.count) return res.status(400).json({ error: 'Add some line items first.' });
    const anomalies = detectAnomalies(summary.lines);
    const result = await generateSummary(req.project, summary, anomalies);
    q.saveSummary.run(JSON.stringify(result), req.project.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
