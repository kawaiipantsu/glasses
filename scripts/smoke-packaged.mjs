import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
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
const root = path.resolve(import.meta.dirname, '..');
const executable =
  process.argv[2] || path.join(root, 'release/mac-arm64/Glasses.app/Contents/MacOS/Glasses');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-package-'));
fs.writeFileSync(
  path.join(dir, 'settings.json'),
  JSON.stringify({ theme: 'dark', proxyPort: await freePort(), socksPort: await freePort() }),
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'plugin-sdk/examples/data-lens.json'), 'utf8'),
);
fs.writeFileSync(path.join(dir, 'plugins.json'), JSON.stringify([{ manifest, enabled: true }]));
const child = spawn(
  executable,
  ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
  {
    env: { ...process.env, GLASSES_TEST_DATA: dir, GLASSES_DEV_URL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let browser,
  errors = '';
child.stderr.on('data', (b) => (errors += b.toString()));
const exit = new Promise((resolve) => child.once('exit', resolve));
try {
  const endpoint = await new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    const timer = setInterval(() => {
      const match = errors.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearInterval(timer);
        resolve(match[1]);
      } else if (child.exitCode !== null || Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error('Packaged app failed to start: ' + errors));
      }
    }, 100);
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().startsWith('glasses://')) || context.pages()[0];
  if (!page) page = await context.waitForEvent('page');
  await page.getByRole('heading', { name: 'Traffic', exact: true }).waitFor();
  assert.match(page.url(), /^glasses:\/\/app\/index.html/, 'release ignores GLASSES_DEV_URL');
  const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, 'version.json'))).application;
  const identity = await page.evaluate(() => window.glasses.invoke('bootstrap'));
  assert.equal(identity.displayVersion, `${expectedVersion.version} (${expectedVersion.build})`);
  assert.equal(identity.architecture, process.arch);
  assert.match(identity.buildInfo.sourceSha256, /^[a-f0-9]{64}$/);
  await page
    .locator('.statusbar')
    .getByText(`v${identity.displayVersion}`, { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Local lab', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.traffic-table tbody tr').length === 6,
  );
  await page.locator('.traffic-table tbody tr').filter({ hasText: '/api/products' }).click();
  await page
    .locator('.traffic-workspace .inspector-pane')
    .nth(1)
    .getByText('"products":', { exact: true })
    .waitFor();
  const output = path.join(root, 'test-results');
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'glasses-packaged-traffic.png') });
  await page.getByRole('button', { name: 'Data Lens', exact: true }).click();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('textbox', { name: 'Selected data' }).fill('{"packaged":true}');
  await frame.getByRole('button', { name: 'Format JSON', exact: true }).press('Enter');
  await page
    .frames()
    .find((f) => f.url().startsWith('glasses-plugin://'))
    .waitForFunction(() =>
      document.getElementById('output').textContent.includes('"packaged": true'),
    );
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'glasses-packaged-settings.png') });
  await page.getByRole('button', { name: 'About Glasses', exact: true }).click();
  await page
    .getByText(
      `Glasses ${identity.displayVersion} · ${identity.platform} ${identity.architecture}`,
      { exact: true },
    )
    .waitFor();
  await page.screenshot({ path: path.join(output, 'glasses-version-about.png') });
  await page.evaluate(() => window.glasses.invoke('stop'));
  console.log(
    'Hardened packaged app passed: ASAR startup, production origin, proxy traffic, extension tool and Settings.',
  );
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  await Promise.race([exit, new Promise((r) => setTimeout(r, 5000))]);
  fs.rmSync(dir, { recursive: true, force: true });
}
