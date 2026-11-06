import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-quit-test-'));
const app = await electron.launch({
  executablePath: require('electron'),
  args: [root],
  env: { ...process.env, GLASSES_TEST_DATA: dir },
});
const child = app.process();
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Traffic', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Toggle proxy', exact: true }).isDisabled(),
    true,
  );
  await assert.rejects(
    page.evaluate(() => window.glasses.invoke('toggleProxy')),
    /disabled in test sessions/,
  );
  await app.evaluate(({ app, dialog }, root) => {
    const require = process.mainModule.require.bind(process.mainModule);
    require(root + '/core/system-proxy.cjs').SystemProxy.prototype.restore = async () => {
      throw new Error('Simulated network authorization failure');
    };
    globalThis.quitChoices = [];
    dialog.showMessageBox = async (options) => {
      globalThis.quitChoices.push(options.buttons);
      return { response: globalThis.quitChoices.length === 1 ? 0 : 1 };
    };
    app.quit();
  }, root);
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  const buttons = await app.evaluate(() => globalThis.quitChoices);
  assert.deepEqual(buttons, [['Keep Glasses open', 'Quit anyway']]);
  await app.close();
  console.log(
    'Recovery smoke passed: system toggles blocked in test sessions; failed restore can keep working or quit anyway.',
  );
} finally {
  if (child.exitCode === null) await app.close().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
}
