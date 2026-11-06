const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { trustedSender, SecurityLog } = require('../core/security.cjs');
const { cleanHeaders } = require('../core/engine.cjs');
const { headersObject } = require('../core/inspectors.cjs');
const { decodedBody } = require('../core/formats.cjs');
const { pluginSchema } = require('../core/plugins.cjs');
test('workspace appearance settings migrate defaults and reject unsafe or unreadable values', (t) => {
  const { Settings, schema } = require('../core/settings.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-appearance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ theme: 'light', density: 'compact' }),
  );
  const settings = new Settings(dir);
  assert.equal(settings.value.theme, 'light');
  assert.equal(settings.value.codeFont, 'system');
  settings.update({
    ...settings.value,
    density: 'custom',
    trafficRowHeight: 26,
    codeFont: 'jetbrains',
    codeFontSize: 14,
    codeLineHeight: 19,
  });
  const loaded = new Settings(dir).value;
  assert.equal(loaded.trafficRowHeight, 26);
  assert.equal(loaded.codeFont, 'jetbrains');
  assert.equal(loaded.codeLineHeight, 19);
  for (const input of [
    { codeFont: 'url(https://example.com/font)' },
    { trafficRowHeight: 0 },
    { sidebarRowHeight: 1000 },
    { codeFontSize: 16, codeLineHeight: 14 },
    { headerRowPadding: -1 },
  ])
    assert.equal(schema.safeParse(input).success, false);
});
test('IPC trust includes window identity, top frame and exact application origin', () => {
  const frame = { url: 'glasses://app/index.html' };
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents };
  const event = { sender: contents, senderFrame: frame };
  assert.equal(trustedSender(event, window, false), true);
  assert.equal(trustedSender({ ...event, sender: {} }, window, false), false);
  assert.equal(trustedSender({ ...event, senderFrame: { url: frame.url } }, window, false), false);
  for (const url of [
    'https://example.com',
    'glasses://attacker/index.html',
    'glasses-plugin://org.test.tool/index.html',
    'file:///index.html',
    'http://127.0.0.1:5173/',
  ]) {
    frame.url = url;
    assert.equal(trustedSender(event, window, false), false, url);
  }
  frame.url = 'http://127.0.0.1:5173/';
  assert.equal(trustedSender(event, window, true), true);
});
test('hostile header names remain data and cannot change object prototypes', () => {
  const input = JSON.parse(
    '{"__proto__":["pollution"],"constructor":"data","x-test":"<svg onload=alert(1)>"}',
  );
  const headers = cleanHeaders(input);
  assert.equal(Object.getPrototypeOf(headers), null);
  assert.deepEqual(headers.__proto__, ['pollution']);
  assert.equal(headers.constructor, 'data');
  assert.equal({}.pollution, undefined);
  assert.equal(Object.getPrototypeOf(headersObject(input)), null);
});
test('compressed bombs stop at the decoder output budget', async () => {
  const payload = zlib.gzipSync(Buffer.alloc(17 * 1024 * 1024, 65));
  const body = await decodedBody(
    {
      responseHeaders: { 'content-encoding': 'gzip', 'content-type': 'text/plain' },
      responseBody: payload.toString('base64'),
    },
    'response',
  );
  assert.equal(body.binary, true);
  assert.match(body.error, /decode limit/);
  assert.equal(body.base64, payload.toString('base64'));
});
test('malformed compressed data is inspectable without crashing', async () => {
  const body = await decodedBody(
    {
      responseHeaders: { 'content-encoding': 'br' },
      responseBody: Buffer.from('not brotli').toString('base64'),
    },
    'response',
  );
  assert.ok(body.error);
  assert.equal(body.binary, true);
});
test('prototype-like content encodings are treated as opaque header data', async () => {
  for (const encoding of ['constructor', '__proto__', 'toString']) {
    const body = await decodedBody(
      {
        responseHeaders: { 'content-encoding': encoding },
        responseBody: Buffer.from('evidence').toString('base64'),
      },
      'response',
    );
    assert.equal(body.text, 'evidence');
    assert.equal(body.error, undefined);
  }
});
test('extension UI contributions require explicit capabilities and unique IDs', () => {
  const example = require('../plugin-sdk/examples/data-lens.json');
  assert.ok(pluginSchema.safeParse(example).success);
  assert.equal(
    pluginSchema.safeParse({ ...example, capabilities: ['selection.read'] }).success,
    false,
  );
  assert.equal(
    pluginSchema.safeParse({
      ...example,
      contextMenus: [{ ...example.contextMenus[0], id: 'data-lens' }],
    }).success,
    false,
  );
  assert.equal(
    pluginSchema.safeParse({
      ...example,
      capabilities: [...example.capabilities, 'filesystem.read'],
    }).success,
    false,
  );
  assert.equal(pluginSchema.safeParse({ ...example, ui: undefined }).success, false);
});
test('operational security logs contain bounded metadata without traffic', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-log-'));
  try {
    const log = new SecurityLog(dir);
    log.record('ipc.rejected', 'untrusted_sender');
    await log.queue;
    const rows = fs.readFileSync(log.file, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['event', 'outcome', 'time']);
    assert.equal(rows[0].event, 'ipc.rejected');
    if (process.platform !== 'win32') assert.equal(fs.statSync(log.file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
