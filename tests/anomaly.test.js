const { summarize } = require('../src/services/calc');
const { detectAnomalies } = require('../src/services/anomaly');

const mk = (rows) => summarize(rows.map(([item, estimated, actual], i) => ({ id: i + 1, category: 'C', item, estimated, actual }))).lines;

describe('unusual expense detection', () => {
  test('flags an extreme variance % outlier', () => {
    const lines = mk([['a', 100, 102], ['b', 100, 98], ['c', 100, 101], ['d', 100, 99], ['e', 100, 103], ['f', 100, 400]]);
    const flagged = detectAnomalies(lines);
    expect(flagged.map((f) => f.item)).toContain('f');
    expect(flagged.find((f) => f.item === 'f').reasons.join()).toMatch(/unusual overrun/);
    expect(flagged.map((f) => f.item)).not.toContain('a');
  });

  test('flags unbudgeted spend (estimate 0)', () => {
    const flagged = detectAnomalies(mk([['x', 0, 500]]));
    expect(flagged[0].reasons[0]).toMatch(/Unbudgeted/);
  });

  test('flags a large money overrun even if % is modest', () => {
    const lines = mk([['small1', 100, 110], ['small2', 200, 210], ['small3', 150, 160], ['small4', 120, 125], ['big', 100000, 115000]]);
    const big = detectAnomalies(lines).find((f) => f.item === 'big');
    expect(big.reasons.join()).toMatch(/Overrun of 15000/);
  });

  test('no statistics with fewer than 4 items, and uniform data has no outliers', () => {
    expect(detectAnomalies(mk([['a', 100, 900], ['b', 100, 100]]))).toEqual([]);
    expect(detectAnomalies(mk([['a', 100, 110], ['b', 100, 110], ['c', 100, 110], ['d', 100, 110]]))).toEqual([]);
  });
});
