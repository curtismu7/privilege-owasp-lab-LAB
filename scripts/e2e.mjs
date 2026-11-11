#!/usr/bin/env node
// Browser check (Playwright, headless Chromium) against a running lab in Mock with Real unconfigured.
//   docker compose up --build -d && npm run e2e            (BASE_URL defaults to http://127.0.0.1:7811)
//   SHOT_DIR=/some/dir npm run e2e                           (also saves desktop dark + light and 375px screenshots)
// Loopback only. Exit 1 on the first failed check.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:7811';
const host = new URL(BASE).hostname;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { console.error(`refusing ${host}: loopback only`); process.exit(1); }
const SHOTS = process.env.SHOT_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); } catch (e) { failed += 1; console.log(`FAIL  ${name}: ${e.message.split('\n')[0]}`); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/`);
  // A clean start: the reset puts this workspace back, the theme starts light.
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* blocked */ } });
  await page.reload();

  await check('page loads in Mock: shell bar, banner first in the page, Mock badge', async () => {
    await page.getByTestId('banner').filter({ hasText: /^MOCK: / }).waitFor({ timeout: 10000 });
    expect(await page.locator('header.shell-bar').count() === 1, 'no shell bar');
    const first = await page.evaluate(() => document.querySelector('main.page').firstElementChild.dataset.testid);
    expect(first === 'banner', `first element in the page is ${first}`);
    expect((await page.getByTestId('mode-badge').textContent()) === 'Mock', 'badge is not Mock');
  });

  await check('Real unconfigured: Real is disabled and its tooltip is the how-to', async () => {
    const real = page.getByTestId('mode-real');
    expect(await real.isDisabled(), 'Real is enabled');
    expect(/PINGONE_/.test(await real.getAttribute('title')), 'tooltip has no how-to');
    await page.getByTestId('real-howto').waitFor();
  });

  await check('run the coverage table: streams, then the slide-21 table with the gap rows shows', async () => {
    await page.getByTestId('run-coverage-table').click();
    await page.getByTestId('coverage-table').waitFor({ timeout: 15000 });
    const t = await page.getByTestId('coverage-table').textContent();
    expect(/Agent Goal Hijack/.test(t), 'ASI01 row not in the table');
    expect(/Rogue Agents/.test(t), 'ASI10 row not in the table');
    expect(/gap stated/.test(t), 'the ASI04/ASI06 gap chips are missing');
    expect(/exit 0/.test(await page.getByTestId('exit-chip').textContent()), 'no exit 0');
    expect(/MOCK data/.test(await page.getByTestId('mock-output').textContent()), 'output not labelled MOCK');
    await page.getByTestId('prereq-chain').waitFor();
    const where = await page.getByTestId('output').evaluate((el) => el.closest("[data-testid^='section-']")?.dataset.testid);
    expect(where === 'section-coverage-table-section', `result rendered in ${where}`);
    expect(/ASI08/.test(await page.getByTestId('coverage-footnote').innerText()), 'the footnote is missing');
  });
  await shot(page, 'desktop-light');

  await check('a category dataset replaces the one result panel and shows the key/value form without a gap field', async () => {
    await page.getByTestId('run-asi03').click();
    await page.getByTestId('category-form').waitFor({ timeout: 15000 });
    const form = await page.getByTestId('category-form').textContent();
    expect(/ASI03 - Identity and Privilege Abuse|ASI03 - Identity & Privilege Abuse/.test(form), 'the ASI03 form is missing');
    expect(/COVERED/.test(form), 'no COVERED status');
    expect(await page.getByTestId('output').count() === 1, 'more than one result panel');
    expect(! (await page.getByTestId('category-form').textContent()).includes('gap stated'), 'ASI03 wrongly carries a gap');
  });

  await check('loading the table again moves the one panel back with the gap rows', async () => {
    await page.getByTestId('run-coverage-table').click();
    await page.getByTestId('coverage-table').waitFor({ timeout: 15000 });
    expect(await page.getByTestId('output').count() === 1, 'more than one result panel');
    expect(await page.getByText('gap stated').count() >= 2, 'the gap chips are missing from the table');
  });

  await check('theme toggle switches <html data-theme> to dark and back', async () => {
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.getByTestId('theme-toggle').click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(before === 'light' && after === 'dark', `${before} -> ${after}`);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg !== 'rgb(252, 252, 252)', 'body did not change colour');
  });
  await shot(page, 'desktop-dark');

  await check('Trace shows the run hops with traceparent (shared evidence screens)', async () => {
    await page.getByTestId('nav-trace').click();
    await page.getByTestId('trace').waitFor();
    expect(/MOCK hops/.test(await page.getByTestId('trace').textContent()), 'no MOCK label');
  });
  await shot(page, 'desktop-dark-trace');

  await check('diagram: Simulate walks the steps, a dragged box moves, Reset restores positions', async () => {
    await page.getByTestId('nav-diagram').click();
    await page.getByTestId('pattern-canvas').waitFor();
    await page.getByRole('button', { name: /Simulate/ }).click();
    await page.getByTestId('pattern-now').waitFor({ timeout: 8000 });
    const box = page.locator('.react-flow__node').first();
    const b = await box.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 80, b.y + b.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await page.getByText(/Moved: 1 box/).waitFor({ timeout: 5000 });
    await page.getByTestId('pattern-reset').click();
    await page.getByText(/Moved: 0 box/).waitFor({ timeout: 5000 });
    expect(await page.getByTestId('pattern-now').count() === 0, 'walkthrough still showing after Reset');
  });
  await shot(page, 'desktop-dark-diagram');

  await check('page Reset clears the run', async () => {
    await page.getByTestId('nav-coverage').click();
    await page.getByTestId('reset').click();
    await page.getByTestId('output').waitFor({ state: 'detached', timeout: 5000 });
  });

  await check('50000-deep JSON output (served by a stubbed stream) stays raw text and the header stays; a done error shows its reason', async () => {
    const deep = `${'['.repeat(50000)}${']'.repeat(50000)}`;
    const frame = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
    await page.route('**/api/stream?*', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: frame('meta', { command: 'privilege-owasp dataset overview', source: 'mock', prereqs: [] }) + frame('chunk', { text: deep }) + frame('done', { exitCode: 1, source: 'mock', error: 'timed out after 15000 ms', hops: [] }) }));
    await page.getByTestId('run-coverage-table').click();
    await page.getByTestId('run-error').waitFor({ timeout: 10000 });
    expect(/timed out after 15000 ms/.test(await page.getByTestId('run-error').textContent()), 'no reason line');
    expect((await page.getByTestId('raw-output').textContent()).startsWith('[[[['), 'deep JSON not shown as raw text');
    expect(await page.locator('header.shell-bar').isVisible(), 'shell bar gone');
    expect(await page.getByTestId('mode-toggle').isVisible(), 'mode toggle gone');
    expect(await page.getByTestId('banner').isVisible(), 'banner gone');
    await page.unroute('**/api/stream?*');
  });

  await check('375px: no horizontal scroll, nav and toggle reachable, a run still works', async () => {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });
    const p = await m.newPage();
    await p.goto(`${BASE}/`);
    await p.getByTestId('banner').filter({ hasText: /^MOCK: / }).waitFor();
    await p.getByTestId('run-two-layers').scrollIntoViewIfNeeded();
    await p.getByTestId('run-two-layers').click();
    await p.getByTestId('exit-chip').waitFor({ timeout: 15000 });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over <= 0, `page scrolls sideways by ${over}px`);
    expect(await p.getByTestId('mode-real').isVisible(), 'toggle not visible');
    expect(await p.getByTestId('nav-diagram').isVisible(), 'nav not visible');
    await shot(p, 'mobile-375-dark');
    await m.close();
  });

  await check('no page errors', async () => { expect(errors.length === 0, errors.join('; ')); });
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
