const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { Plugins } = require('../core/plugins.cjs');
const {
  Community,
  parseInstallUri,
  verifyEnvelope,
  verifyPackage,
  compareVersions,
  fetchBytes,
  packageUrl,
} = require('../core/community.cjs');
const key = crypto.generateKeyPairSync('ed25519'),
  keys = { test: key.publicKey };
const identity = { id: 'org.test.extension', version: '1.0.0' },
  now = 1793970000;
const manifest = {
  apiVersion: 1,
  ...identity,
  name: 'Test tool',
  author: 'Example',
  description: 'Example',
  capabilities: [],
};
function fixture(m = manifest, overrides = {}) {
  const bytes = Buffer.from(JSON.stringify(m));
  const d = {
    schemaVersion: 1,
    packageId: m.id,
    version: m.version,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    downloadUrl: packageUrl({ id: m.id, version: m.version }, 'download'),
    capabilities: m.capabilities,
    issuedAt: now,
    expiresAt: now + 300,
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(d));
  const envelope = Buffer.from(
    JSON.stringify({
      algorithm: 'Ed25519',
      keyId: 'test',
      payload: payload.toString('base64url'),
      signature: crypto.sign(null, payload, key.privateKey).toString('base64url'),
    }),
  );
  return { bytes, d, envelope };
}
function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-community-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Plugins(dir);
}
test('install links accept only bounded identities, never remote locations or extra parameters', () => {
  assert.deepEqual(
    parseInstallUri('glasses://install?id=org.test.extension&version=1.0.0'),
    identity,
  );
  for (const uri of [
    'https://install?id=org.test.extension&version=1.0.0',
    'glasses://user@install?id=org.test.extension&version=1.0.0',
    'glasses://install:1?id=org.test.extension&version=1.0.0',
    'glasses://install/exec?id=org.test.extension&version=1.0.0',
    'glasses://install?id=org.test.extension&version=1.0.0&url=https://evil.test',
    'glasses://install?id=org.test.extension&id=evil.pkg&version=1.0.0',
    'glasses://install?id=../evil&version=1.0.0',
    'glasses://install?id=org.test.extension&version=1.0.0#x',
  ])
    assert.throws(() => parseInstallUri(uri));
  assert.equal(compareVersions('1.10.0', '1.2.99'), 1);
  assert.throws(() => compareVersions('999999999999999.0.0', '1.0.0'));
});
test('signed descriptors fail closed on unknown keys, tampering, expiry and URL/identity changes', () => {
  const f = fixture();
  assert.equal(verifyEnvelope(f.envelope, identity, keys, now).sha256, f.d.sha256);
  assert.throws(() => verifyEnvelope(f.envelope, identity, {}, now), /Unknown/);
  const altered = JSON.parse(f.envelope);
  altered.payload = Buffer.from(JSON.stringify({ ...f.d, size: 100 })).toString('base64url');
  assert.throws(
    () => verifyEnvelope(Buffer.from(JSON.stringify(altered)), identity, keys, now),
    /signature/,
  );
  for (const change of [
    { expiresAt: now },
    { issuedAt: now + 61, expiresAt: now + 300 },
    { expiresAt: now + 601 },
    { downloadUrl: 'https://evil.test/package' },
    { packageId: 'other.package' },
    { version: '2.0.0' },
    { capabilities: ['ui.tools', 'ui.tools'] },
  ])
    assert.throws(() => verifyEnvelope(fixture(manifest, change).envelope, identity, keys, now));
  const padded = JSON.parse(f.envelope);
  padded.signature += '=';
  assert.throws(
    () => verifyEnvelope(Buffer.from(JSON.stringify(padded)), identity, keys, now),
    /encoding/,
  );
});
test('artifact verification checks exact bytes, manifest identity, capability set and schema', () => {
  const f = fixture();
  assert.equal(verifyPackage(f.bytes, f.d).id, identity.id);
  assert.throws(
    () => verifyPackage(Buffer.concat([f.bytes, Buffer.from(' ')]), f.d),
    /checksum or size/,
  );
  assert.throws(() => verifyPackage(f.bytes, { ...f.d, packageId: 'other.pkg' }), /differs/);
  assert.throws(
    () => verifyPackage(f.bytes, { ...f.d, capabilities: ['selection.read'] }),
    /differs/,
  );
  const invalid = fixture({ ...manifest, unexpected: 'field' });
  assert.throws(() => verifyPackage(invalid.bytes, invalid.d));
});
test('preview does not install; reviewed tickets are one-use, persistent and expiry bounded', async (t) => {
  const plugins = store(t),
    f = fixture();
  let clock = now;
  const client = new Community(plugins, {
    keys,
    now: () => clock,
    fetch: async (url) => (url.endsWith('/install') ? f.envelope : f.bytes),
  });
  const preview = await client.preview(identity);
  assert.equal(plugins.items.length, 0);
  assert.equal(preview.manifest.ui, undefined);
  client.install({ ticket: preview.ticket, enable: false });
  assert.equal(plugins.items[0].enabled, false);
  assert.equal(new Plugins(path.dirname(plugins.file)).items[0].community.sha256, f.d.sha256);
  assert.throws(() => client.install({ ticket: preview.ticket, enable: true }), /expired/);
  plugins.remove(identity.id);
  const next = await client.preview(identity);
  clock = now + 301;
  assert.throws(() => client.install({ ticket: next.ticket, enable: true }), /expired/);
  assert.equal(plugins.items.length, 0);
});
test('updates cannot take over local IDs, downgrade, or race changes made after review', async (t) => {
  const plugins = store(t);
  plugins.install(manifest);
  let f = fixture({ ...manifest, version: '1.1.0', capabilities: ['selection.read'] });
  const client = new Community(plugins, {
    keys,
    now: () => now,
    fetch: async (url) => (url.endsWith('/install') ? f.envelope : f.bytes),
  });
  await assert.rejects(client.preview({ ...identity, version: '1.1.0' }), /local plugin/);
  plugins.items[0].community = {
    keyId: 'test',
    sha256: fixture().d.sha256,
    installedAt: new Date(now * 1000).toISOString(),
  };
  const review = await client.preview({ ...identity, version: '1.1.0' });
  assert.deepEqual(review.addedCapabilities, ['selection.read']);
  plugins.toggle(identity.id, true);
  assert.throws(() => client.install({ ticket: review.ticket, enable: true }), /changed/);
  const next = await client.preview({ ...identity, version: '1.1.0' });
  client.install({ ticket: next.ticket, enable: true });
  assert.equal(plugins.items[0].manifest.version, '1.1.0');
  f = fixture();
  await assert.rejects(client.preview(identity), /Downgrades/);
});
test('installation rolls back in-memory state if persistence fails', async (t) => {
  const plugins = store(t),
    f = fixture();
  const client = new Community(plugins, {
    keys,
    now: () => now,
    fetch: async (url) => (url.endsWith('/install') ? f.envelope : f.bytes),
  });
  const preview = await client.preview(identity);
  plugins.save = () => {
    throw new Error('disk full');
  };
  assert.throws(() => client.install({ ticket: preview.ticket, enable: true }), /disk full/);
  assert.equal(plugins.items.length, 0);
});
test('catalog strips untrusted install locations and does not accept oversized input', async (t) => {
  const plugins = store(t),
    entry = {
      ...manifest,
      kind: 'plugin',
      publisher: { id: 1, displayName: 'Publisher' },
      size: 100,
      sha256: 'a'.repeat(64),
      publishedAt: '2026-11-06',
      installUrl: 'https://evil.test',
      installUri: 'file:///etc/passwd',
    };
  const client = new Community(plugins, {
    fetch: async () =>
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          items: [entry],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
  });
  const result = await client.catalog({ q: '', kind: '', page: 1 });
  assert.equal(result.items[0].installUrl, undefined);
  assert.equal(result.items[0].installUri, undefined);
  await assert.rejects(client.catalog({ q: 'a'.repeat(201), kind: '', page: 1 }));
});
test('HTTPS client rejects redirects, alternate origins, oversized and compressed responses', async (t) => {
  const original = https.get;
  t.after(() => (https.get = original));
  let status = 200,
    body = Buffer.from('{}'),
    headers = {};
  let calls = 0;
  https.get = (url, options, callback) => {
    calls++;
    assert.equal(url.origin, 'https://glasses.thugs.red');
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.agent, false);
    assert.ok(Array.isArray(options.ca));
    const req = new EventEmitter();
    req.destroy = (error) => {
      queueMicrotask(() => req.emit('error', error));
    };
    setImmediate(() => {
      const res = new PassThrough();
      req.destroy = (error) => {
        queueMicrotask(() => {
          req.emit('error', error);
          res.destroy(error);
        });
      };
      res.statusCode = status;
      res.headers = headers;
      callback(res);
      res.end(body);
    });
    return req;
  };
  await assert.rejects(fetchBytes('https://evil.test/api/v1/catalog', 20), /outside/);
  assert.equal(calls, 0);
  assert.equal((await fetchBytes('https://glasses.thugs.red/api/v1/catalog', 20)).toString(), '{}');
  status = 302;
  await assert.rejects(fetchBytes('https://glasses.thugs.red/api/v1/catalog', 20), /HTTP 302/);
  status = 200;
  body = Buffer.alloc(21);
  await assert.rejects(fetchBytes('https://glasses.thugs.red/api/v1/catalog', 20), /size limit/);
  body = Buffer.from('{}');
  headers = { 'content-encoding': 'gzip' };
  await assert.rejects(fetchBytes('https://glasses.thugs.red/api/v1/catalog', 20), /encoding/);
});
