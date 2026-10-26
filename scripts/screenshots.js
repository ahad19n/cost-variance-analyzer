// Captures documentation screenshots with Playwright.
// Usage: start the app (seeded), then  BASE_URL=http://localhost:3000 npm run screenshots
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const SAMPLES = path.join(__dirname, '..', 'sample-data');
fs.mkdirSync(OUT, { recursive: true });

async function login(page, user, pass) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=username]', user);
  await page.fill('input[name=password]', pass);
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')]);
}

// Adds an evidence caption (request URL / context) to security screenshots.
const caption = (page, text) => page.evaluate((t) => {
  const d = document.createElement('div');
  d.textContent = t;
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:10px 16px;background:#111;color:#fff;font:13px ui-monospace,monospace;z-index:9999';
  document.body.appendChild(d);
}, text);

const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts }).then(() => console.log(`  ${name}.png`));

(async () => {
  // Uses the system Chrome if present (PW_CHANNEL=chrome), else Playwright's bundled Chromium.
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', acceptDownloads: true });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`);
  await shot(page, '01-login');

  await login(page, 'alice', 'alice-demo-pass');
  await shot(page, '02-dashboard');

  const projectUrl = await page.locator('table.data a', { hasText: 'Customer Portal Rebuild' }).first().getAttribute('href');
  await page.goto(BASE + projectUrl);
  await page.waitForTimeout(1200); // chart animation
  await shot(page, '03-project-overview', { fullPage: false });
  await page.locator('.charts').screenshot({ path: path.join(OUT, '04-charts.png') });
  console.log('  04-charts.png');

  await page.click('#btn-ai');
  await page.waitForFunction(() => document.querySelector('#btn-ai').textContent.trim() === 'Regenerate', null, { timeout: 60000 });
  await page.locator('#ai').scrollIntoViewIfNeeded();
  await page.locator('#ai').evaluate((el) => el.parentElement.scrollIntoView({ block: 'center' }));
  await page.locator('#ai').locator('xpath=..').screenshot({ path: path.join(OUT, '05-ai-summary-and-anomalies.png') });
  console.log('  05-ai-summary-and-anomalies.png');

  await page.locator('#items').screenshot({ path: path.join(OUT, '06-line-items-table.png') });
  console.log('  06-line-items-table.png');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-pdf')]);
  await download.saveAs(path.join(__dirname, '..', 'docs', 'sample-report.pdf'));
  console.log('  ../sample-report.pdf');

  // Upload flow in a fresh project
  await page.goto(`${BASE}/`);
  await page.fill('input[name=name]', 'Excel import demo');
  await Promise.all([page.waitForURL(/\/projects\/\d+$/), page.click('form[action="/projects"] button')]);
  await page.setInputFiles('#file', path.join(SAMPLES, 'valid.xlsx'));
  await page.click('#upload-form button[type=submit]');
  await page.waitForSelector('#preview-table tbody tr');
  await page.locator('#input').screenshot({ path: path.join(OUT, '07-upload-preview.png') });
  console.log('  07-upload-preview.png');

  // Security demonstrations
  await page.setInputFiles('#file', path.join(SAMPLES, 'fake-executable.csv'));
  await page.click('#upload-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#upload-msg').textContent.startsWith('Rejected'));
  await page.locator('#input .card').nth(1).screenshot({ path: path.join(OUT, '08-sec-invalid-upload-rejected.png') });
  console.log('  08-sec-invalid-upload-rejected.png');

  await page.setInputFiles('#file', path.join(SAMPLES, 'invalid-rows.csv'));
  await page.click('#upload-form button[type=submit]');
  await page.waitForSelector('#upload-errors li');
  await page.locator('#input .card').nth(1).screenshot({ path: path.join(OUT, '09-sec-row-validation.png') });
  console.log('  09-sec-row-validation.png');

  // IDOR: alice tries bob's project id (seed creates it as #2)
  const resp = await page.goto(`${BASE}/projects/2`);
  await caption(page, `Logged in as alice -> GET /projects/2 (owned by bob) -> HTTP ${resp.status()}`);
  await shot(page, '10-sec-unauthorized-project-404');

  // Dark mode
  const ctx3 = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'dark' });
  const p3 = await ctx3.newPage();
  await login(p3, 'alice', 'alice-demo-pass');
  await p3.goto(BASE + projectUrl);
  await p3.waitForTimeout(1200);
  await shot(p3, '12-project-dark-mode');
  await ctx3.close();

  // Mobile
  const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p4 = await ctx4.newPage();
  await login(p4, 'alice', 'alice-demo-pass');
  await p4.goto(BASE + projectUrl);
  await p4.waitForTimeout(1200);
  await shot(p4, '13-project-mobile');
  await ctx4.close();

  // Rate limit: brute-force login in a fresh context
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 700 } });
  const p2 = await ctx2.newPage();
  for (let i = 0; i < 6; i++) {
    await p2.goto(`${BASE}/login`);
    await p2.fill('input[name=username]', 'alice');
    await p2.fill('input[name=password]', `wrong-password-${i}`);
    await Promise.all([p2.waitForLoadState('load'), p2.click('button[type=submit]')]);
  }
  await caption(p2, 'POST /login x6 with wrong passwords from one client within 60 s -> attempt 6: HTTP 429 Too Many Requests');
  await shot(p2, '11-sec-rate-limited-429');
  await ctx2.close();

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
