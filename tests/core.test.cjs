const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { once } = require('node:events');
const { Settings } = require('../core/settings.cjs');
const { Certificates } = require('../core/certificates.cjs');
const { Plugins, pluginSchema } = require('../core/plugins.cjs');
const { Engine } = require('../core/engine.cjs');
const { inspectHeaders, inspectTLS } = require('../core/inspectors.cjs');
const { decodedBody, toHar } = require('../core/formats.cjs');
let dir, settings, certs, plugins, engine, target, secure, base, secureBase;
async function handler(req, res) {
  let body = '';
  for await (const c of req) body += c;
  if (req.url === '/slow') await new Promise((r) => setTimeout(r, 80));
  res.setHeader('content-type', 'application/json');
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.url === '/large') return res.end(Buffer.alloc(3 * 1024 * 1024, 65));
  const data = JSON.stringify({
    method: req.method,
    url: req.url,
    body,
    marker: req.headers['x-marker'] || null,
  });
  if (req.url === '/gzip') {
    res.setHeader('content-encoding', 'gzip');
    res.end(zlib.gzipSync(data));
  } else res.end(data);
}
const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-test-'));
  settings = new Settings(dir);
  certs = new Certificates(dir);
  plugins = new Plugins(dir);
  engine = new Engine(settings, certs, plugins);
  target = http.createServer(handler);
  base = `http://127.0.0.1:${await listen(target)}`;
  secure = https.createServer(certs.leaf('localhost'), handler);
  secureBase = `https://localhost:${await listen(secure)}`;
  await engine.start({ proxyPort: 0, socksPort: 0 });
});
after(async () => {
  await engine.stop();
  await Promise.all([new Promise((r) => target.close(r)), new Promise((r) => secure.close(r))]);
  fs.rmSync(dir, { recursive: true, force: true });
});
function proxyRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: engine.port,
        path: url,
        method: options.method || 'GET',
        headers: options.headers || {},
        agent: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}
function nextIntercept(phase) {
  return new Promise((resolve) => {
    const listener = (r) => {
      if (r.state === 'intercepted' && r.interceptPhase === phase) {
        engine.off('record', listener);
        resolve(r);
      }
    };
    engine.on('record', listener);
  });
}
test('captures actual HTTP requests and response bytes', async () => {
  const r = await proxyRequest(base + '/echo', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'hello',
  });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).body, 'hello');
  const record = [...engine.records.values()].at(-1);
  assert.equal(record.state, 'complete');
  assert.equal(record.requestBytes, 5);
  assert.equal(Buffer.from(record.requestBody, 'base64').toString(), 'hello');
  assert.ok(record.timings.firstByte >= 0);
});
test('MITM CONNECT uses a trusted leaf and records decrypted HTTPS', async () => {
  const url = new URL(secureBase);
  const result = await new Promise((resolve, reject) => {
    const connect = http.request({
      host: '127.0.0.1',
      port: engine.port,
      method: 'CONNECT',
      path: `localhost:${url.port}`,
      agent: false,
    });
    connect.on('error', reject);
    connect.on('connect', (_, socket) => {
      const encrypted = tls.connect({
        socket,
        servername: 'localhost',
        ca: certs.pem,
        rejectUnauthorized: true,
      });
      encrypted.on('error', reject);
      let data = '';
      encrypted.on('data', (c) => (data += c));
      encrypted.on('end', () => resolve(data));
      encrypted.on('secureConnect', () =>
        encrypted.write(
          `GET /secure HTTP/1.1\r\nHost: localhost:${url.port}\r\nConnection: close\r\n\r\n`,
        ),
      );
    });
    connect.end();
  });
  assert.match(result, /200 OK/);
  assert.match(result, /secure/);
  const record = [...engine.records.values()].at(-1);
  assert.equal(record.protocol, 'HTTPS');
  assert.equal(record.state, 'complete');
});
test('intercepts and mutates a request before forwarding', async () => {
  settings.value.interceptPhase = 'request';
  engine.setIntercept(true);
  const paused = nextIntercept('request');
  const response = proxyRequest(base + '/before');
  const r = await paused;
  engine.resolveIntercept(r.id, {
    action: 'forward',
    request: {
      url: base + '/after',
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'edited',
      bodyEncoding: 'utf8',
    },
  });
  const result = JSON.parse((await response).body);
  assert.equal(result.url, '/after');
  assert.equal(result.body, 'edited');
  engine.setIntercept(false);
});
test('intercepts a response and forwards edited content', async () => {
  settings.value.interceptPhase = 'response';
  engine.setIntercept(true);
  const paused = nextIntercept('response');
  const response = proxyRequest(base + '/response');
  const r = await paused;
  engine.resolveIntercept(r.id, {
    action: 'forward',
    response: {
      status: 202,
      headers: { 'content-type': 'text/plain' },
      body: 'changed',
      bodyEncoding: 'utf8',
    },
  });
  const result = await response;
  assert.equal(result.status, 202);
  assert.equal(result.body.toString(), 'changed');
  engine.setIntercept(false);
});
test('forward/drop handling releases pending requests', async () => {
  settings.value.interceptPhase = 'request';
  engine.setIntercept(true);
  const paused = nextIntercept('request');
  const response = proxyRequest(base + '/drop');
  const r = await paused;
  engine.resolveIntercept(r.id, { action: 'drop' });
  assert.equal((await response).status, 502);
  assert.equal(engine.pending.size, 0);
  engine.setIntercept(false);
});
test('streams responses beyond capture limits without losing bytes', async () => {
  settings.value.bodyLimitMB = 1;
  const result = await proxyRequest(base + '/large');
  assert.equal(result.body.length, 3 * 1024 * 1024);
  const r = [...engine.records.values()].at(-1);
  assert.equal(r.truncated, true);
  assert.equal(Buffer.from(r.responseBody, 'base64').length, 1024 * 1024);
  settings.value.bodyLimitMB = 2;
});
test('large intercepted responses automatically forward without pausing', async () => {
  settings.value.bodyLimitMB = 1;
  settings.value.interceptPhase = 'response';
  engine.setIntercept(true);
  const result = await proxyRequest(base + '/large');
  assert.equal(result.body.length, 3 * 1024 * 1024);
  assert.equal(engine.pending.size, 0);
  engine.setIntercept(false);
  settings.value.bodyLimitMB = 2;
});
test('decompresses captured content and exports usable HAR', async () => {
  await proxyRequest(base + '/gzip');
  const r = [...engine.records.values()].at(-1);
  assert.equal(JSON.parse((await decodedBody(r, 'response')).text).url, '/gzip');
  const har = toHar([r]);
  assert.equal(har.log.entries[0].response.content.encoding, 'base64');
  assert.equal(har.log.entries[0].request.url, base + '/gzip');
});
test('rules and installed plugin capabilities are enforced', async () => {
  const manifest = require('../plugin-sdk/examples/security-headers.json');
  plugins.install(manifest);
  assert.equal(plugins.items[0].enabled, false);
  plugins.toggle(manifest.id, true);
  engine.rules = [
    {
      id: 'test',
      name: 'Marker',
      enabled: true,
      phase: 'request',
      match: '/rules',
      action: 'set-header',
      header: 'X-Marker',
      value: 'working',
    },
  ];
  const result = await proxyRequest(base + '/rules');
  assert.equal(JSON.parse(result.body).marker, 'working');
  assert.ok(plugins.analyze([...engine.records.values()].at(-1)).length);
  assert.throws(() => pluginSchema.parse({ ...manifest, capabilities: [] }));
  engine.rules = [];
  plugins.remove(manifest.id);
});
test('repeater payload runs have distinct results and cancellation', async () => {
  const job = engine.run({
    request: {
      url: base + '/search?q={{payload}}&i={{iteration}}',
      method: 'GET',
      headers: {},
      body: '',
    },
    iterations: 3,
    concurrency: 2,
    delayMs: 0,
    payloads: ['one', 'two'],
  });
  const complete = await new Promise((resolve) => {
    const fn = (j) => {
      if (j.id === job.id && j.done) {
        engine.off('job', fn);
        resolve(j);
      }
    };
    engine.on('job', fn);
  });
  assert.equal(complete.completed, 3);
  assert.equal(complete.results.length, 3);
  assert.ok([...engine.records.values()].some((r) => r.url.includes('q=two&i=2')));
  const stopped = engine.run({
    request: { url: base + '/slow', method: 'GET', headers: {}, body: '' },
    iterations: 100,
    concurrency: 1,
    delayMs: 0,
    payloads: [],
  });
  engine.cancelJob(stopped.id);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(engine.jobs.get(stopped.id).completed < 100);
});
test('SOCKS5 supports fragmented greetings and TCP CONNECT', async () => {
  const socket = net.connect(engine.socks.address().port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(Buffer.from([5]));
  socket.write(Buffer.from([1, 0]));
  assert.deepEqual((await once(socket, 'data'))[0], Buffer.from([5, 0]));
  const port = target.address().port;
  const request = Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, port >> 8, port & 255]);
  socket.write(request.subarray(0, 3));
  socket.write(request.subarray(3));
  const reply = (await once(socket, 'data'))[0];
  assert.equal(reply[1], 0);
  socket.write('GET /socks HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  let data = '';
  for await (const chunk of socket) data += chunk;
  assert.match(data, /200 OK/);
  assert.match(data, /socks/);
});
test('TLS inspector observes upstream certificate and trust failures', async () => {
  const report = await inspectTLS(secureBase);
  assert.equal(report.host, 'localhost');
  assert.equal(report.authorized, false);
  assert.ok(report.chain.length);
  assert.match(report.protocol, /TLS/);
  assert.match(report.chain[0].pem, /BEGIN CERTIFICATE/);
});
test('header checks distinguish absent policies and incompatible CORS', () => {
  const findings = inspectHeaders({
    url: 'https://test.invalid',
    responseHeaders: {
      'content-type': 'text/html',
      'access-control-allow-origin': '*',
      'access-control-allow-credentials': 'true',
      'set-cookie': ['id=x; Path=/'],
    },
  });
  assert.ok(findings.some((f) => f.header === 'content-security-policy' && f.level === 'review'));
  assert.ok(
    findings.some((f) => f.header === 'access-control-allow-credentials' && f.level === 'warning'),
  );
  assert.ok(findings.some((f) => f.header === 'set-cookie'));
});
test('rejects unsafe headers, invalid settings and non-HTTP replay URLs', async () => {
  await assert.rejects(
    engine.replay({ url: 'file:///etc/passwd', method: 'GET', headers: {}, body: '' }),
  );
  await assert.rejects(
    engine.replay({ url: base, method: 'GET', headers: { test: 'a\r\nb: c' }, body: '' }),
  );
  assert.throws(() => settings.update({ ...settings.value, proxyPort: 1080, socksPort: 1080 }));
});
test('rejects self-proxy loops without blocking legitimate local targets', async () => {
  await assert.rejects(
    engine.replay({
      url: `http://127.0.0.1:${engine.port}/`,
      method: 'GET',
      headers: {},
      body: '',
    }),
    /listener itself/,
  );
  assert.equal((await proxyRequest(base + '/still-works')).status, 200);
});
test('cancelling concurrent delayed workers wakes every worker promptly', async () => {
  const job = engine.run({
    request: { url: base + '/delay', method: 'GET', headers: {}, body: '' },
    iterations: 100,
    concurrency: 3,
    delayMs: 10000,
    payloads: [],
  });
  await new Promise((resolve) => {
    const fn = (j) => {
      if (j.id === job.id && j.completed >= 3) {
        engine.off('job', fn);
        setImmediate(resolve);
      }
    };
    engine.on('job', fn);
  });
  const finished = new Promise((resolve) => {
    const fn = (j) => {
      if (j.id === job.id && j.done) {
        engine.off('job', fn);
        resolve(j);
      }
    };
    engine.on('job', fn);
  });
  engine.cancelJob(job.id);
  let timer;
  const result = await Promise.race([
    finished,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Delayed workers did not cancel promptly')), 1000);
    }),
  ]);
  clearTimeout(timer);
  assert.equal(result.cancelled, true);
  assert.ok(result.completed < 100);
});
