// Statistical "unusual expense" detection. Runs locally, no AI service required.
//
// Two complementary rules:
//  1. Variance-% z-score: an item whose overrun/underrun is far from the project's typical
//     variance (|z| > Z_LIMIT) is flagged.
//  2. Overrun-amount IQR fence (Tukey): an item whose overrun in money terms is far above
//     its peers (> Q3 + 1.5 * IQR) is flagged, catching big-ticket overruns whose % looks modest.
// Plus a hard rule: anything with an actual cost but a zero estimate is unplanned spend.

const { round2 } = require('./calc');

const Z_LIMIT = 2;
const MIN_ITEMS = 4; // statistics on fewer points are meaningless

function mean(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdev(xs) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

function quantile(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function detectAnomalies(lines) {
  const flags = new Map(); // line id/index -> reasons[]
  const add = (key, reason) => {
    if (!flags.has(key)) flags.set(key, []);
    flags.get(key).push(reason);
  };
  const keyOf = (l, i) => l.id ?? i;

  lines.forEach((l, i) => {
    if (l.estimated === 0 && l.actual > 0) add(keyOf(l, i), 'Unbudgeted expense (estimate was 0)');
  });

  const withPct = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.variancePct !== null);
  if (withPct.length >= MIN_ITEMS) {
    const pcts = withPct.map(({ l }) => l.variancePct);
    const m = mean(pcts);
    const sd = stdev(pcts);
    if (sd > 0) {
      for (const { l, i } of withPct) {
        const z = (l.variancePct - m) / sd;
        if (Math.abs(z) > Z_LIMIT) {
          const dir = z > 0 ? 'overrun' : 'underrun';
          add(keyOf(l, i), `Variance ${l.variancePct}% is an unusual ${dir} (z = ${round2(z)})`);
        }
      }
    }
  }

  if (lines.length >= MIN_ITEMS) {
    const sorted = lines.map((l) => l.variance).sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const fence = q3 + 1.5 * (q3 - q1);
    // When most items share the same variance the IQR collapses to 0, so also require the
    // overrun to be at least double the typical (median absolute) variance.
    const absSorted = lines.map((l) => Math.abs(l.variance)).sort((a, b) => a - b);
    const floor = 2 * quantile(absSorted, 0.5);
    lines.forEach((l, i) => {
      if (l.status === 'Over' && l.variance > fence && l.variance > floor) {
        add(keyOf(l, i), `Overrun of ${l.variance.toFixed(2)} is far above typical items (fence ${round2(fence)})`);
      }
    });
  }

  return lines
    .map((l, i) => ({ line: l, reasons: flags.get(keyOf(l, i)) }))
    .filter((x) => x.reasons)
    .map(({ line, reasons }) => ({
      id: line.id,
      category: line.category,
      item: line.item,
      estimated: line.estimated,
      actual: line.actual,
      variance: line.variance,
      variancePct: line.variancePct,
      reasons,
    }));
}

module.exports = { detectAnomalies, Z_LIMIT, MIN_ITEMS };
