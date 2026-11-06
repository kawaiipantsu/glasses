import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-community-ui-'));
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
const app = await electron.launch({
  executablePath: require('electron'),
  args: [root],
  env: { ...process.env, GLASSES_TEST_DATA: dir },
  timeout: 30000,
});
const child = app.process();
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: 'Traffic', exact: true }).waitFor();
  // Fixtures exist only in this development automation process. Production has no test trust override.
  await app.evaluate((_, root) => {
    const require = process.mainModule.require.bind(process.mainModule),
      crypto = require('node:crypto');
    const { Community, packageUrl } = require(root + '/core/community.cjs');
    const fixture = JSON.parse(
      require('node:fs').readFileSync(root + '/plugin-sdk/examples/data-lens.json', 'utf8'),
    );
    fixture.id = 'org.test.community-lens';
    fixture.name = 'Community Lab Lens';
    fixture.author = 'Local test publisher';
    fixture.version = '1.0.0';
    globalThis.communityFixture = fixture;
    globalThis.communityFetches = 0;
    const keys = crypto.generateKeyPairSync('ed25519');
    const preview = Community.prototype.preview;
    Community.prototype.catalog = async () => {
      globalThis.communityFetches++;
      const m = globalThis.communityFixture;
      return {
        schemaVersion: 1,
        items: [
          {
            id: m.id,
            name: m.name,
            version: m.version,
            description: m.description,
            author: m.author,
            kind: 'extension',
            publisher: { id: 1, displayName: 'Local test publisher' },
            capabilities: m.capabilities,
            size: 7013,
            sha256: 'a'.repeat(64),
            publishedAt: new Date().toISOString(),
          },
        ],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      };
    };
    Community.prototype.preview = async function (identity) {
      const m = globalThis.communityFixture,
        bytes = Buffer.from(JSON.stringify(m)),
        now = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          packageId: m.id,
          version: m.version,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
          size: bytes.length,
          downloadUrl: packageUrl(identity, 'download'),
          capabilities: m.capabilities,
          issuedAt: now,
          expiresAt: now + 300,
        }),
      );
      const envelope = Buffer.from(
        JSON.stringify({
          algorithm: 'Ed25519',
          keyId: 'test-only',
          payload: payload.toString('base64url'),
          signature: crypto.sign(null, payload, keys.privateKey).toString('base64url'),
        }),
      );
      this.keys = { 'test-only': keys.publicKey };
      this.fetch = async (url) => {
        globalThis.communityFetches++;
        return url.endsWith('/install') ? envelope : bytes;
      };
      return preview.call(this, identity);
    };
  }, root);
  await app.evaluate(({ app }) =>
    app.emit(
      'open-url',
      { preventDefault() {} },
      'glasses://install?id=org.test.community-lens&version=1.0.0',
    ),
  );
  await page.getByText('Install request from your browser', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.communityFetches), 0);
  assert.equal((await page.evaluate(() => window.glasses.invoke('bootstrap'))).plugins.length, 0);
  await page.getByRole('button', { name: 'Connect and browse', exact: true }).click();
  await page.getByRole('heading', { name: 'Community Lab Lens', exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'test-results/glasses-community.png') });
  await page.getByRole('button', { name: 'Review package', exact: true }).click();
  await page.getByRole('heading', { name: 'Review community install', exact: true }).waitFor();
  await page.getByText('Community signature verified', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'test-results/glasses-community-review.png') });
  assert.equal((await page.evaluate(() => window.glasses.invoke('bootstrap'))).plugins.length, 0);
  await page.getByRole('button', { name: 'Install & enable', exact: true }).click();
  await page.getByText('Community package installed and enabled.', { exact: true }).waitFor();
  let plugins = (await page.evaluate(() => window.glasses.invoke('bootstrap'))).plugins;
  assert.equal(plugins[0].enabled, true);
  assert.equal(plugins[0].community.keyId, 'test-only');
  await app.evaluate(() => {
    globalThis.communityFixture.version = '1.1.0';
    globalThis.communityFixture.capabilities.push('response.analyze');
  });
  await page.getByRole('button', { name: 'Browse catalog', exact: true }).click();
  await page.getByRole('button', { name: 'Review update', exact: true }).click();
  await page.getByText('New permission', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Install disabled', exact: true }).click();
  await page.getByText('Community package installed, disabled.', { exact: true }).waitFor();
  plugins = (await page.evaluate(() => window.glasses.invoke('bootstrap'))).plugins;
  assert.equal(plugins[0].enabled, false);
  assert.equal(plugins[0].manifest.version, '1.1.0');
  assert.deepEqual(errors, []);
  console.log(
    'Community desktop smoke passed: browser handoff stays inactive, explicit connection, signed review, install/enable, permission-changing update and disabled install.',
  );
} finally {
  if (child.exitCode === null) await app.close().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
}
