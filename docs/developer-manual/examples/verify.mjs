// Developer-only regression harness. Never bundle this into ui.javascript.
import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname,
  'json-workbench.glasses-plugin.json'), 'utf8'));
const { pluginSchema, applyRules } = require('../../../core/plugins.cjs');
const { requestSchema } = require('../../../core/engine.cjs');
assert.ok(pluginSchema.safeParse(manifest).success);
assert.equal(pluginSchema.safeParse({ ...manifest, background: {} }).success, false);
assert.equal(pluginSchema.safeParse({ ...manifest, capabilities: [] }).success, false);
assert.equal(pluginSchema.safeParse({ ...manifest, version: '1.0.0-beta' }).success, false);
assert.equal(pluginSchema.safeParse({ ...manifest,
  contextMenus: [{ ...manifest.contextMenus[0], id: 'workbench' }] }).success, false);
const draft = { url: 'https://example.com', method: 'POST', headers: {}, body: '' };
assert.ok(requestSchema.safeParse(draft).success);
assert.equal(requestSchema.safeParse({ ...draft, headers: { x: 'a\r\nb' } }).success, false);
assert.equal(requestSchema.safeParse({ ...draft, url: 'https://u:p@example.com' }).success, false);
const headers = { host: 'original' };
assert.deepEqual(applyRules([{ enabled: true, phase: 'request', match: '',
  action: 'set-header', header: 'Host', value: 'other', name: 'blocked' }],
  'request', { url: 'https://example.com' }, headers), []);
assert.equal(headers.host, 'original');

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-manual-'));
const output = path.join(root, 'tmp/pdfs');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(data, 'plugins.json'), JSON.stringify([{ manifest, enabled: true }]));
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const proxyPort = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({
  theme: 'dark', proxyPort, socksEnabled: false,
}));
const app = await electron.launch({ executablePath: require('electron'), args: [root],
  env: { ...process.env, GLASSES_TEST_DATA: data }, timeout: 30000 });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Traffic', exact: true }).waitFor();
  await page.getByRole('button', { name: 'JSON Workbench', exact: true }).click();
  let frame = page.frames().find((f) => f.url().startsWith('glasses-plugin://'));
  if (!frame) {
    await page.frameLocator('iframe').getByRole('heading', { name: 'JSON Workbench' }).waitFor();
    frame = page.frames().find((f) => f.url().startsWith('glasses-plugin://'));
  }
  await frame.waitForFunction(() => Boolean(window.glassesContext));
  const input = frame.getByRole('textbox', { name: 'JSON input', exact: true });
  const format = frame.getByRole('button', { name: 'Format JSON', exact: true });
  const preview = frame.getByRole('button', { name: 'Open transform preview', exact: true });
  assert.equal(await preview.isDisabled(), true);
  assert.equal(await frame.getByRole('button', { name: 'Prepare original request in Repeater' }).isDisabled(), true);
  const hostile = { label: '<img src=x onerror=alert(1)>', city: 'København', count: 3 };
  await input.fill(JSON.stringify(hostile));
  await format.click();
  assert.equal(await frame.locator('#output').textContent(), JSON.stringify(hostile, null, 2));
  assert.equal(await frame.locator('#output img').count(), 0);
  assert.equal(await preview.isEnabled(), true);
  await preview.click();
  await page.getByRole('dialog', { name: 'Transform selection' }).waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await input.fill('{invalid');
  assert.equal(await preview.isDisabled(), true);
  await format.click();
  assert.match(await frame.locator('#status').textContent(), /Invalid JSON/);
  assert.equal(await frame.locator('#output').textContent(), '');
  await input.fill('x'.repeat(262145));
  await format.click();
  assert.match(await frame.locator('#status').textContent(), /256 KiB/);
  await input.fill('{"manual":true,"city":"København","items":[1,2,3]}');
  await format.click();
  const snapshot = await frame.evaluate(() => window.glassesContext);
  await page.locator('iframe').evaluate((el, context) => {
    el.contentWindow.postMessage({ glassesHost: 1, context }, '*');
  }, snapshot);
  assert.match(await input.inputValue(), /manual/);
  const isolation = await frame.evaluate(async () => {
    let parentBlocked = false, storageBlocked = false, networkBlocked = false;
    try { void parent.document.body; } catch { parentBlocked = true; }
    try { localStorage.setItem('test', '1'); } catch { storageBlocked = true; }
    try { await fetch('https://example.com'); } catch { networkBlocked = true; }
    return { parentBlocked, storageBlocked, networkBlocked,
      requireType: typeof window.require, appBridge: typeof window.glasses };
  });
  assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true,
    networkBlocked: true, requireType: 'undefined', appBridge: 'undefined' });
  await page.locator('iframe').screenshot({ path: path.join(output, 'workbench.png') });
  // Test at a deliberately narrow frame; this is a layout probe, not a host setting.
  await page.locator('iframe').evaluate((el) => { el.style.width = '420px'; });
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('iframe').screenshot({ path: path.join(output, 'workbench-narrow.png') });
  await page.locator('iframe').evaluate((el) => { el.style.width = ''; });
  await page.getByRole('button', { name: 'Traffic', exact: true }).click();
  await page.getByRole('button', { name: 'Local lab', exact: true }).click();
  const products = page.locator('.traffic-table tbody tr').filter({ hasText: '/api/products' }).last();
  await products.waitFor();
  await products.click();
  const before = await page.locator('.traffic-table tbody tr').count();
  await page.getByRole('button', { name: 'JSON Workbench', exact: true }).click();
  const f = page.frameLocator('iframe');
  await f.getByRole('button', { name: 'Prepare original request in Repeater' }).click();
  const url = page.getByRole('textbox', { name: 'Request URL', exact: true });
  await url.waitFor();
  assert.match(await url.inputValue(), /127\.0\.0\.1:\d+\/api\/products$/);
  const after = await page.evaluate(async () => (await window.glasses.invoke('bootstrap')).records.length);
  assert.equal(after, before, 'Preparing a draft must not create a network request');
  console.log('PASS: schema negatives, protected headers, formatter, Unicode, inert HTML,');
  console.log('stale-output clearing, limits, duplicate context, preview, sandbox, narrow layout,');
  console.log('selected-record handoff and no automatic network send.');
} finally {
  await app.close();
  fs.rmSync(data, { recursive: true, force: true });
}
