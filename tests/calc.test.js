const { computeLine, summarize, variancePct } = require('../src/services/calc');

describe('variance calculations', () => {
  test('variance and percentage for an overrun', () => {
    const l = computeLine({ estimated: 1000, actual: 1250 });
    expect(l.variance).toBe(250);
    expect(l.variancePct).toBe(25);
    expect(l.status).toBe('Over');
  });

  test('underrun gives negative variance', () => {
    const l = computeLine({ estimated: 2000, actual: 1500 });
    expect(l.variance).toBe(-500);
    expect(l.variancePct).toBe(-25);
    expect(l.status).toBe('Under');
  });

  test('within +/-5% is On budget (boundary inclusive)', () => {
    expect(computeLine({ estimated: 100, actual: 105 }).status).toBe('On budget');
    expect(computeLine({ estimated: 100, actual: 95 }).status).toBe('On budget');
    expect(computeLine({ estimated: 100, actual: 105.01 }).status).toBe('Over');
  });

  test('zero estimate: percentage is undefined (null), not Infinity', () => {
    expect(variancePct(0, 500)).toBeNull();
    const l = computeLine({ estimated: 0, actual: 500 });
    expect(l.variance).toBe(500);
    expect(l.status).toBe('Over');
    expect(computeLine({ estimated: 0, actual: 0 }).status).toBe('On budget');
  });

  test('floating point is rounded to cents', () => {
    expect(computeLine({ estimated: 0.1, actual: 0.3 }).variance).toBe(0.2);
  });

  test('summarize aggregates totals and categories', () => {
    const s = summarize([
      { category: 'A', estimated: 100, actual: 150 },
      { category: 'A', estimated: 100, actual: 100 },
      { category: 'B', estimated: 300, actual: 270 },
    ]);
    expect(s.totals).toMatchObject({ count: 3, estimated: 500, actual: 520, variance: 20, variancePct: 4, status: 'On budget' });
    const a = s.byCategory.find((c) => c.category === 'A');
    expect(a).toMatchObject({ count: 2, estimated: 200, actual: 250, variance: 50, variancePct: 25 });
    expect(s.counts).toEqual({ over: 1, onBudget: 1, under: 1 });
  });

  test('empty project', () => {
    const s = summarize([]);
    expect(s.totals).toMatchObject({ count: 0, estimated: 0, actual: 0, variance: 0, variancePct: null });
    expect(s.byCategory).toEqual([]);
  });
});
