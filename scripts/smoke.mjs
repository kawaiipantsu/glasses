import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-ui-'));
fs.writeFileSync(
  path.join(data, 'settings.json'),
  JSON.stringify({ theme: 'dark', proxyPort: await freePort(), socksPort: await freePort() }),
);
const app = await electron.launch({
  executablePath: process.env.GLASSES_EXECUTABLE || require('electron'),
  args: process.env.GLASSES_EXECUTABLE ? [] : [root],
  env: { ...process.env, GLASSES_TEST_DATA: data },
  timeout: 30000,
});
const failures = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => failures.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('Renderer:', msg.text());
  });
  await page.getByRole('heading', { name: 'Traffic', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Local lab', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.traffic-table tbody tr').length === 6,
  );
  const products = page
    .locator('.traffic-table tbody tr')
    .filter({ hasText: '/api/products' })
    .last();
  await products.click();
  await page
    .locator('.traffic-workspace .inspector-pane')
    .nth(1)
    .getByText('"products":', { exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-traffic-dark.png') });
  const labBase = await page.evaluate(async () => {
    const b = await window.glasses.invoke('bootstrap');
    return new URL(b.records.find((r) => r.url.endsWith('/api/products')).url).origin;
  });
  await page.evaluate(
    (url) =>
      window.glasses.invoke('replay', {
        url: url + '/lab/inert-html',
        method: 'GET',
        headers: {},
        body: '',
      }),
    labBase,
  );
  await page.locator('.traffic-table tbody tr').filter({ hasText: '/lab/inert-html' }).click();
  const hostileBody = page.locator('.traffic-workspace .inspector-pane').nth(1);
  await hostileBody.getByText('globalThis.__glassesInjected', { exact: false }).first().waitFor();
  assert.equal(
    await hostileBody
      .locator(
        '.inspector-content script,.inspector-content img,.inspector-content svg,.inspector-content iframe,.inspector-content a',
      )
      .count(),
    0,
  ); // no payload-created DOM elements
  assert.equal(await page.evaluate(() => globalThis.__glassesInjected), undefined);
  const countBefore = await page.locator('.traffic-table tbody tr').count();
  assert.ok(countBefore >= 7);
  await products.click();

  await page
    .locator('.traffic-workspace .inspector-pane')
    .nth(1)
    .locator('.code')
    .click({ button: 'right' });
  await page.getByRole('menu', { name: 'Response text' }).waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-response-context-menu.png') });
  await page.getByRole('menuitem', { name: 'Encode / decode selection…' }).click();
  await page.getByRole('dialog', { name: 'Transform selection' }).waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'glasses-settings-appearance.png') });
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.app.light'));
  await page.screenshot({ path: path.join(output, 'glasses-settings-light.png') });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Back to workspace' }).click();
  await page.getByRole('button', { name: 'Send to Repeater', exact: true }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await page.locator('.repeater-response .status-code.good').waitFor();
  await page.getByRole('button', { name: 'Iterations / fuzz', exact: true }).click();
  const current = await page
    .getByRole('textbox', { name: 'Request URL', exact: true })
    .inputValue();
  await page
    .getByRole('textbox', { name: 'Request URL', exact: true })
    .fill(current + '?q={{payload}}');
  await page.getByRole('spinbutton', { name: 'Iterations', exact: true }).fill('3');
  await page.getByRole('tab', { name: 'Payloads', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Fuzz payloads', exact: true })
    .fill('first\nsecond\nthird');
  await page.getByRole('button', { name: 'Run iterations', exact: true }).click();
  await page.getByText('Complete · 3/3', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-repeater.png') });
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.locator('.timeline-row').first().waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-timeline.png') });
  await page.getByRole('button', { name: 'Header Hardening', exact: true }).click();
  await page.locator('.finding').first().waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-headers.png') });
  // Exercise installation through the UI with a deterministic native file selection.
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    },
    path.join(root, 'plugin-sdk/examples/data-lens.json'),
  );
  await page.getByRole('button', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Install from file', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review plugin capabilities' }).waitFor();
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await page.getByRole('switch', { name: 'Enable Data Lens' }).click();
  await page.getByRole('button', { name: 'Data Lens', exact: true }).click();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading', { name: 'Data Lens', exact: true }).waitFor();
  await frame.getByRole('textbox', { name: 'Selected data' }).fill('{"research":true,"count":3}');
  await frame.getByRole('button', { name: 'Format JSON', exact: true }).press('Enter');
  await page.waitForFunction(() => document.querySelector('iframe') !== null);
  const pluginFrame = page.frames().find((f) => f.url().startsWith('glasses-plugin://'));
  assert.ok(pluginFrame, 'extension frame loaded');
  await pluginFrame.waitForFunction(() =>
    document.getElementById('output').textContent.includes('"research": true'),
  );
  const sandbox = await pluginFrame.evaluate(async () => {
    let parentBlocked = false,
      storageBlocked = false,
      networkBlocked = false;
    try {
      void parent.document.body;
    } catch {
      parentBlocked = true;
    }
    try {
      localStorage.setItem('probe', 'x');
    } catch {
      storageBlocked = true;
    }
    try {
      await fetch('https://example.com');
    } catch {
      networkBlocked = true;
    }
    return {
      parentBlocked,
      storageBlocked,
      networkBlocked,
      requireType: typeof window.require,
      bridgeType: typeof window.glasses,
      rtcType: typeof window.RTCPeerConnection,
    };
  });
  assert.deepEqual(sandbox, {
    parentBlocked: true,
    storageBlocked: true,
    networkBlocked: true,
    requireType: 'undefined',
    bridgeType: 'undefined',
    rtcType: 'undefined',
  });
  await page.screenshot({ path: path.join(output, 'glasses-extension-tool.png') });
  await frame
    .getByRole('button', { name: 'Prepare request in Repeater', exact: true })
    .press('Enter');
  await page.getByRole('textbox', { name: 'Request URL', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Traffic', exact: true }).click();
  await products.click();
  // Context contribution appears on response body and receives only selected context.
  const response = page.locator('.traffic-workspace .inspector-pane').nth(1).locator('.code');
  await response.waitFor();
  await response.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await response.click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Data Lens · Inspect in Data Lens', exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-context-with-extension.png') });
  await page
    .getByRole('menuitem', { name: 'Data Lens · Inspect in Data Lens', exact: true })
    .click();
  await frame.getByRole('textbox', { name: 'Selected data' }).waitFor();
  await page
    .frames()
    .find((f) => f.url().startsWith('glasses-plugin://'))
    .waitForFunction(() => document.getElementById('input').value.length > 0);
  await page.getByRole('button', { name: 'Traffic', exact: true }).click();
  // Research browser opens on the local target, captures HTTPS separately in core tests.
  const browserPromise = app.waitForEvent('window');
  await page.evaluate(
    (url) => window.glasses.invoke('browser', url),
    current.replace('/api/products', '/'),
  );
  const browser = await browserPromise;
  await browser.waitForLoadState('domcontentloaded');
  await browser.close();
  // Capture a real paused local request for the manual.
  await page.evaluate(() => window.glasses.invoke('intercept', true));
  const proxyStatus = await page.evaluate(
    async () => (await window.glasses.invoke('bootstrap')).status,
  );
  const pausedResponse = new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: proxyStatus.proxyPort, path: labBase + '/api/profile' },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', reject);
  });
  await page
    .getByRole('button', { name: /^Intercept/ })
    .first()
    .click();
  await page.getByRole('textbox', { name: 'Intercept URL', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-intercept.png') });
  await page.getByRole('button', { name: 'Forward', exact: true }).click();
  await pausedResponse;
  await page.evaluate(() => window.glasses.invoke('intercept', false));
  // Settings persistence, bypass validation, CA switching, and current branding.
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await page.getByRole('button', { name: 'Proxy & interception', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Privacy bypass list' })
    .fill('*.corp.example\n10.0.0.0/8\n2001:db8::/32');
  await page.getByRole('button', { name: 'Add proxy hop', exact: true }).click();
  await page.getByRole('textbox', { name: 'Hop 1 host' }).fill('proxy.corp.example');
  await page.getByRole('spinbutton', { name: 'Hop 1 port' }).fill('3128');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.waitForFunction(
    async () => (await window.glasses.invoke('bootstrap')).settings.relayHops.length === 1,
  );
  await page
    .getByRole('heading', { name: 'Proxy / SOCKS relaying', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'glasses-relay-settings.png') });
  await page.getByRole('textbox', { name: 'Privacy bypass list' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'glasses-bypass-settings.png') });
  const relayGroup = page
    .locator('.settings-group')
    .filter({ has: page.getByRole('heading', { name: 'Proxy / SOCKS relaying', exact: true }) });
  await relayGroup.screenshot({ path: path.join(output, 'glasses-relay-detail.png') });
  const bypassGroup = page
    .locator('.settings-group')
    .filter({ has: page.getByRole('heading', { name: 'Privacy bypass list', exact: true }) });
  await bypassGroup.screenshot({ path: path.join(output, 'glasses-bypass-detail.png') });
  const persisted = await page.evaluate(
    async () => (await window.glasses.invoke('bootstrap')).settings,
  );
  assert.equal(persisted.relayEnabled, false);
  assert.equal(persisted.relayHops[0].host, 'proxy.corp.example');
  assert.equal(persisted.relayHops[0].password, undefined);
  // Imported keys are read only by main; native file choices are deterministic in this smoke test.
  await page.evaluate(() => window.glasses.invoke('stop'));
  const { Certificates } = require('../core/certificates.cjs');
  const organization = new Certificates(path.join(data, 'organization'));
  await app.evaluate(
    ({ dialog }, files) => {
      let index = 0;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files[index++]] });
    },
    [organization.caPath, organization.keyPath],
  );
  await page.getByRole('button', { name: 'Certificates', exact: true }).click();
  await page
    .getByRole('button', { name: 'Import certificate & signing key…', exact: true })
    .click();
  await page.getByText('Organization CA', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-ca-settings.png') });
  const ca = await page.evaluate(async () => (await window.glasses.invoke('bootstrap')).ca);
  assert.equal(ca.source, 'custom');
  assert.ok(!JSON.stringify(ca).includes('PRIVATE KEY'));
  await page
    .locator('.settings-group')
    .filter({ has: page.getByRole('heading', { name: 'Use your organization’s CA', exact: true }) })
    .screenshot({ path: path.join(output, 'glasses-ca-detail.png') });
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  const tlsDemo = https.createServer(organization.leaf('localhost'), (_, res) =>
    res.end('Glasses TLS lab'),
  );
  tlsDemo.listen(0, '127.0.0.1');
  await once(tlsDemo, 'listening');
  try {
    await page.getByRole('button', { name: 'TLS Inspector', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'TLS endpoint', exact: true })
      .fill(`https://localhost:${tlsDemo.address().port}`);
    await page.getByRole('button', { name: 'Inspect TLS', exact: true }).click();
    await page.getByText('Certificate chain trusted', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'glasses-tls.png') });
  } finally {
    tlsDemo.closeAllConnections();
    await new Promise((resolve) => tlsDemo.close(resolve));
  }
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Certificates', exact: true }).click();
  await page.getByRole('button', { name: 'Use local CA', exact: true }).click();
  await page.getByText('Generated locally', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'About Glasses', exact: true }).click();
  await page.getByRole('button', { name: 'glasses.thugs.red', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-about.png') });
  assert.deepEqual(failures, []);
  console.log(
    'Desktop smoke passed: live traffic, context menus, themes, replay/fuzz, timeline, headers, plugin UI/capabilities/isolation, research browser.',
  );
  console.log(`Screenshots: ${output}`);
} catch (error) {
  const pages = app.windows();
  if (pages[0])
    await pages[0].screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app.close();
  fs.rmSync(data, { recursive: true, force: true });
}
