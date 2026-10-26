// Security tests (Part B, item 11). All payloads are harmless test data.
const fs = require('fs');
const path = require('path');
const { app, request, csrfFrom, registerAgent, createProject, uploadAndCommit, makeZip } = require('./helpers');

const sample = (n) => fs.readFileSync(path.join(__dirname, '..', 'sample-data', n));
const upload = (agent, id, buf, name) =>
  agent.post(`/projects/${id}/upload`).set('X-CSRF-Token', agent.csrf).set('Accept', 'application/json').attach('file', buf, name);

let alice; let bob; let aliceProject;

beforeAll(async () => {
  alice = await registerAgent('alice_t');
  bob = await registerAgent('bob_t');
  aliceProject = await createProject(alice, 'Alice confidential');
  await uploadAndCommit(alice, aliceProject, sample('valid.csv'), 'valid.csv');
});

describe('ST-1 Invalid / malicious file uploads are rejected', () => {
  let p; let carol;
  // Own user: the upload rate limit (10/min/user) would otherwise trip during this block.
  beforeAll(async () => { carol = await registerAgent('carol_t'); p = await createProject(carol, 'Upload tests'); });

  test('executable disguised as .csv (MZ header, binary) -> 415', async () => {
    const res = await upload(carol, p, sample('fake-executable.csv'), 'invoice.csv');
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/binary/i);
  });

  test('disallowed extension (.exe / .html / .xlsm) -> 415', async () => {
    for (const name of ['payload.exe', 'page.html', 'macro.xlsm']) {
      const res = await upload(carol, p, Buffer.from('category,item,estimated,actual\nA,b,1,2\n'), name);
      expect(res.status).toBe(415);
    }
  });

  test('oversized file (3 MB) -> 413', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 'a');
    const res = await upload(carol, p, big, 'big.csv');
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  test('CSV with wrong columns -> 400 with a helpful message', async () => {
    const res = await upload(carol, p, sample('missing-columns.csv'), 'missing.csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required column/);
  });

  test('.xlsx that is not a ZIP -> 415', async () => {
    const res = await upload(carol, p, Buffer.from('category,item\n'), 'fake.xlsx');
    expect(res.status).toBe(415);
  });

  test('zip bomb .xlsx (40 KB that expands to 40 MB) -> 400 before decompression', async () => {
    const bomb = makeZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(40 * 1024 * 1024, 0) }]);
    expect(bomb.length).toBeLessThan(100 * 1024);
    const res = await upload(carol, p, bomb, 'bomb.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/zip bomb|expands/i);
  });

  test('too many rows (5,001) -> 400', async () => {
    const csv = `category,item,estimated,actual\n${'A,b,1,2\n'.repeat(5001)}`;
    const res = await upload(carol, p, Buffer.from(csv), 'many.csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Too many rows/);
  });

  test('invalid rows are reported and not imported', async () => {
    const res = await upload(carol, p, sample('invalid-rows.csv'), 'mixed.csv');
    expect(res.status).toBe(200);
    expect(res.body.validCount).toBe(1);
    expect(res.body.errorCount).toBe(4);
  });
});

describe('ST-2 Unauthorized project access (IDOR / broken access control)', () => {
  const routes = (id) => [
    ['get', `/projects/${id}`],
    ['get', `/projects/${id}/data.json`],
    ['get', `/projects/${id}/anomalies`],
    ['get', `/projects/${id}/report.pdf`],
    ['get', `/projects/${id}/report.xlsx`],
    ['get', `/projects/${id}/report.csv`],
  ];

  test("bob cannot read any of alice's project endpoints (404, no data leaked)", async () => {
    for (const [method, url] of routes(aliceProject)) {
      const res = await bob[method](url).set('Accept', 'application/json');
      expect([403, 404]).toContain(res.status);
      expect(res.text).not.toMatch(/Alice confidential|Backend development/);
    }
  });

  test("bob cannot modify, delete or run AI on alice's project", async () => {
    const posts = [
      [`/projects/${aliceProject}/items`, { category: 'X', item: 'injected', estimated: 1, actual: 1 }],
      [`/projects/${aliceProject}/items/clear`, {}],
      [`/projects/${aliceProject}/delete`, {}],
      [`/projects/${aliceProject}/summary`, {}],
    ];
    for (const [url, body] of posts) {
      const res = await bob.post(url).set('X-CSRF-Token', bob.csrf).set('Accept', 'application/json').send(body);
      expect(res.status).toBe(404);
    }
    const still = await alice.get(`/projects/${aliceProject}/data.json`);
    expect(still.status).toBe(200);
    expect(still.body.lines).toHaveLength(18);
    expect(still.body.lines.map((l) => l.item)).not.toContain('injected');
  });

  test("bob's dashboard does not list alice's project", async () => {
    const res = await bob.get('/');
    expect(res.text).not.toMatch(/Alice confidential/);
  });

  test('unauthenticated requests are redirected to login / 401', async () => {
    const anon = request(app);
    expect((await anon.get(`/projects/${aliceProject}`)).status).toBe(302);
    expect((await anon.get(`/projects/${aliceProject}/data.json`).set('Accept', 'application/json')).status).toBe(401);
  });

  test('malformed IDs are rejected safely', async () => {
    for (const id of ['abc', '-1', '1.5', `${aliceProject} OR 1=1`]) {
      const res = await alice.get(`/projects/${encodeURIComponent(id)}`);
      expect(res.status).toBe(404);
    }
  });
});

describe('ST-4 CSV / formula injection in exported reports', () => {
  let p;
  beforeAll(async () => {
    p = await createProject(alice, 'Formula test');
    const r = await uploadAndCommit(alice, p, sample('formula-injection.csv'), 'f.csv');
    expect(r.status).toBe(200);
  });

  test('CSV export prefixes =, +, -, @ cells with a quote', async () => {
    const res = await alice.get(`/projects/${p}/report.csv`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`'=HYPERLINK`);
    expect(res.text).toContain(`'+SUM(1+1)`);
    expect(res.text).toContain(`'@cmd`);
    expect(res.text).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });

  test('XLSX export stores them as text, not formulas', async () => {
    const ExcelJS = require('exceljs');
    const res = await alice.get(`/projects/${p}/report.xlsx`).buffer(true).parse((r, cb) => {
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.getWorksheet('Line items');
    const values = [];
    ws.eachRow((row) => row.eachCell((c) => values.push(c.value)));
    expect(values.some((v) => v && typeof v === 'object' && 'formula' in v)).toBe(false);
    expect(values).toContain(`'=1+1`);
  });
});

describe('ST-5 Stored XSS is neutralised by output encoding + CSP', () => {
  let p;
  beforeAll(async () => {
    p = await createProject(alice, '<script>alert("proj")</script>');
    await uploadAndCommit(alice, p, sample('xss.csv'), 'x.csv');
  });

  test('script tags are HTML-escaped in the project page', async () => {
    const res = await alice.get(`/projects/${p}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<script>alert('xss')</script>");
    expect(res.text).not.toContain('<img src=x onerror');
    expect(res.text).toContain('&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;');
  });

  test('Content-Security-Policy forbids inline scripts', async () => {
    const res = await alice.get(`/projects/${p}`);
    const csp = res.headers['content-security-policy'];
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).not.toMatch(/unsafe-inline/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });
});

describe('ST-6 SQL injection', () => {
  test("classic ' OR 1=1-- login bypass fails", async () => {
    const agent = request.agent(app);
    const token = await csrfFrom(agent);
    const res = await agent.post('/login').type('form').send({ _csrf: token, username: "alice_t' OR 1=1--", password: "' OR '1'='1" });
    expect(res.status).toBe(401);
  });

  test('SQL in a project name is stored literally (parameterised queries)', async () => {
    const name = "x'); DROP TABLE projects;--";
    const id = await createProject(bob, name);
    const res = await bob.get(`/projects/${id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('x&#39;); DROP TABLE projects;--');
    expect((await alice.get(`/projects/${aliceProject}`)).status).toBe(200);
  });
});

describe('ST-7 CSRF protection', () => {
  test('state-changing POST without token -> 403', async () => {
    const res = await alice.post('/projects').type('form').send({ name: 'csrf' });
    expect(res.status).toBe(403);
  });
  test('POST with a token from another session -> 403', async () => {
    const res = await alice.post(`/projects/${aliceProject}/delete`).type('form').send({ _csrf: bob.csrf });
    expect(res.status).toBe(403);
    expect((await alice.get(`/projects/${aliceProject}`)).status).toBe(200);
  });
  test('JSON upload without header token -> 403', async () => {
    const res = await alice.post(`/projects/${aliceProject}/upload`).set('Accept', 'application/json').attach('file', sample('valid.csv'), 'v.csv');
    expect(res.status).toBe(403);
  });
});

describe('ST-8 Session and header hardening', () => {
  test('session cookie is HttpOnly and SameSite=Lax', async () => {
    const res = await request(app).get('/login');
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('cva.sid='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
  test('security headers present and X-Powered-By removed', async () => {
    const res = await request(app).get('/login');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  test('errors do not leak stack traces', async () => {
    const res = await alice.post(`/projects/${aliceProject}/upload/commit`).set('X-CSRF-Token', alice.csrf).set('Content-Type', 'application/json').send('{"bad json');
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(/at .*\.js:\d+|SyntaxError/);
  });
});
