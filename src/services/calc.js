// Pure cost/variance calculations. No I/O so they are easy to unit test.

const ON_BUDGET_BAND = 5; // +/- percent treated as "on budget"

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function variancePct(estimated, actual) {
  if (estimated === 0) return null; // undefined: cannot express as % of zero
  return round2(((actual - estimated) / Math.abs(estimated)) * 100);
}

function status(pct, variance) {
  if (pct === null) return variance > 0 ? 'Over' : variance < 0 ? 'Under' : 'On budget';
  if (pct > ON_BUDGET_BAND) return 'Over';
  if (pct < -ON_BUDGET_BAND) return 'Under';
  return 'On budget';
}

function computeLine(item) {
  const variance = round2(item.actual - item.estimated);
  const pct = variancePct(item.estimated, item.actual);
  return { ...item, variance, variancePct: pct, status: status(pct, variance) };
}

function aggregate(estimated, actual) {
  const variance = round2(actual - estimated);
  const pct = variancePct(estimated, actual);
  return {
    estimated: round2(estimated),
    actual: round2(actual),
    variance,
    variancePct: pct,
    status: status(pct, variance),
  };
}

function summarize(items) {
  const lines = items.map(computeLine);

  const cats = new Map();
  for (const l of lines) {
    const c = cats.get(l.category) || { estimated: 0, actual: 0, count: 0 };
    c.estimated += l.estimated;
    c.actual += l.actual;
    c.count += 1;
    cats.set(l.category, c);
  }
  const byCategory = [...cats.entries()]
    .map(([category, c]) => ({ category, count: c.count, ...aggregate(c.estimated, c.actual) }))
    .sort((a, b) => b.actual - a.actual);

  const totEst = lines.reduce((s, l) => s + l.estimated, 0);
  const totAct = lines.reduce((s, l) => s + l.actual, 0);

  return {
    lines,
    byCategory,
    totals: { count: lines.length, ...aggregate(totEst, totAct) },
    counts: {
      over: lines.filter((l) => l.status === 'Over').length,
      onBudget: lines.filter((l) => l.status === 'On budget').length,
      under: lines.filter((l) => l.status === 'Under').length,
    },
  };
}

module.exports = { computeLine, summarize, variancePct, round2, ON_BUDGET_BAND };
