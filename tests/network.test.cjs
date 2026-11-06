const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http'),
  https = require('node:https'),
  net = require('node:net'),
  tls = require('node:tls'),
  crypto = require('node:crypto');
const { once } = require('node:events');
const { Settings } = require('../core/settings.cjs');
const { Router, Bypass, parseBypass } = require('../core/routing.cjs');
const { Certificates } = require('../core/certificates.cjs');
const { Plugins } = require('../core/plugins.cjs');
const { Engine } = require('../core/engine.cjs');
const { createSocks } = require('../core/socks.cjs');
const { SystemProxy } = require('../core/system-proxy.cjs');
const { Secrets } = require('../core/secrets.cjs');
const forge = require('node-forge');
let dir,
  settings,
  certs,
  engine,
  origin,
  secure,
  relay,
  socks,
  ports = {},
  events = [],
  sockets = new Set();
const track = (s) => {
  sockets.add(s);
  s.on('error', () => {});
  s.on('close', () => sockets.delete(s));
  return s;
};
async function listen(server) {
  server.on('connection', track);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
function hop(type, port) {
  return {
    id: crypto.randomUUID(),
    type,
    host: '127.0.0.1',
    port,
    username: '',
    hasPassword: false,
  };
}
function request(url) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port: engine.port, path: url, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    r.on('error', reject);
  });
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-network-'));
  settings = new Settings(dir);
  certs = new Certificates(dir);
  engine = new Engine(settings, certs, new Plugins(dir));
  origin = http.createServer((req, res) => {
    events.push({ type: 'origin', auth: req.headers['proxy-authorization'] });
    res.end('private destination');
  });
  ports.origin = await listen(origin);
  secure = https.createServer(certs.leaf('localhost'), (_, res) => res.end('secure destination'));
  ports.secure = await listen(secure);
  relay = http.createServer((req, res) => {
    events.push({ type: 'forward', url: req.url, auth: req.headers['proxy-authorization'] });
    const target = new URL(req.url);
    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    const r = http.request(target, { headers }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    r.on('error', () => res.destroy());
    req.pipe(r);
  });
  relay.on('connect', (req, client, head) => {
    events.push({ type: 'connect', url: req.url, auth: req.headers['proxy-authorization'] });
    const url = new URL('http://' + req.url);
    const peer = track(net.connect({ host: url.hostname, port: Number(url.port) }));
    peer.once('connect', () => {
      client.write('HTTP/1.1 200 OK\r\n\r\n');
      if (head.length) peer.write(head);
      client.pipe(peer);
      peer.pipe(client);
    });
    client.on('close', () => peer.destroy());
    peer.on('close', () => client.destroy());
  });
  ports.relay = await listen(relay);
  socks = createSocks(() => () => {});
  ports.socks = await listen(socks);
  await engine.start({ proxyPort: 0, socksPort: 0 });
});
after(async () => {
  await engine.stop();
  for (const s of sockets) s.destroy();
  await socks.shutdown();
  await Promise.all([origin, secure, relay].map((s) => new Promise((r) => s.close(r))));
  fs.rmSync(dir, { recursive: true, force: true });
});
test('bypass host matching, domain boundaries, IPv4/IPv6 and DNS CIDRs', async () => {
  const b = new Bypass('private.example\n*.corp.example\n10.0.0.0/8\n2001:db8::/32', async () => [
    { address: '10.2.3.4' },
  ]);
  assert.equal(await b.matches('PRIVATE.example.'), true);
  assert.equal(await b.matches('a.corp.example'), true);
  const exact = new Bypass('*.corp.example');
  assert.equal(await exact.matches('corp.example'), false);
  assert.equal(await exact.matches('notcorp.example'), false);
  assert.equal(await b.matches('10.10.0.1'), true);
  assert.equal(await b.matches('[2001:db8::1]'), true);
  assert.equal(await b.matches('dns.internal'), true);
  for (const rule of [
    'example.com/path',
    '10.0.0.1/33',
    'foo*bar',
    'https://example.com',
    '::1/129',
  ])
    assert.throws(() => parseBypass(rule));
});
test('privacy bypass streams without history, rules, or interception', async () => {
  settings.value.bypassList = '127.0.0.1';
  engine.clear();
  engine.setIntercept(true);
  const result = await request(`http://127.0.0.1:${ports.origin}/confidential`);
  assert.equal(result.body, 'private destination');
  assert.equal(engine.records.size, 0);
  assert.equal(engine.pending.size, 0);
  await assert.rejects(
    engine.replay({ url: `http://127.0.0.1:${ports.origin}`, method: 'GET', headers: {} }),
    /bypass/,
  );
  engine.setIntercept(false);
  settings.value.bypassList = '';
});
test('excluded CONNECT preserves the actual upstream TLS certificate and emits nothing', async () => {
  settings.value.bypassList = 'localhost';
  engine.clear();
  const result = await new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1',
      port: engine.port,
      method: 'CONNECT',
      path: `localhost:${ports.secure}`,
    });
    r.on('error', reject);
    r.on('connect', (_, socket) => {
      const s = tls.connect({ socket, servername: 'localhost', ca: certs.pem });
      s.on('error', reject);
      s.once('secureConnect', () => {
        const actual = s.getPeerCertificate().fingerprint256;
        const expected = new crypto.X509Certificate(certs.leaf('localhost').cert).fingerprint256;
        s.end();
        resolve({ actual, expected });
      });
    });
    r.end();
  });
  assert.equal(result.actual, result.expected);
  assert.equal(engine.records.size, 0);
  settings.value.bypassList = '';
});
test('HTTP forwarding uses absolute URLs and keeps hop credentials away from origins', async () => {
  const h = { ...hop('http', ports.relay), username: 'researcher', hasPassword: true };
  settings.value.relayEnabled = true;
  settings.value.relayHops = [h];
  engine.router.password = (id) => (id === h.id ? 'secret' : '');
  events = [];
  const result = await request(`http://127.0.0.1:${ports.origin}/relay`);
  assert.equal(result.status, 200);
  assert.equal(events[0].type, 'forward');
  assert.equal(events[0].auth, 'Basic ' + Buffer.from('researcher:secret').toString('base64'));
  assert.equal(events.at(-1).auth, undefined);
});
test('ordered HTTP then SOCKS5 chain carries HTTPS and privacy bypass traffic', async () => {
  settings.value.relayHops = [hop('http', ports.relay), hop('socks5', ports.socks)];
  events = [];
  const r = await engine.replay({
    url: `https://localhost:${ports.secure}/chained`,
    method: 'GET',
    headers: {},
  });
  assert.equal(r.status, 200);
  assert.ok(events.some((e) => e.url === `127.0.0.1:${ports.socks}`));
  settings.value.bypassList = '127.0.0.1';
  engine.clear();
  const result = await request(`http://127.0.0.1:${ports.origin}/excluded`);
  assert.equal(result.status, 200);
  assert.equal(engine.records.size, 0);
  settings.value.bypassList = '';
});
test('unreachable relay fails closed without reaching the destination', async () => {
  const temp = net.createServer();
  const port = await listen(temp);
  await new Promise((r) => temp.close(r));
  settings.value.relayHops = [hop('http', port)];
  events = [];
  const result = await request(`http://127.0.0.1:${ports.origin}/must-not-arrive`);
  assert.equal(result.status, 502);
  assert.equal(events.length, 0);
  settings.value.relayEnabled = false;
  settings.value.relayHops = [];
});
test('proxy journal restores exact PAC, bypass, and authenticated proxy configuration', async () => {
  let services = [
    {
      id: 'wifi',
      name: 'Wi-Fi',
      enabled: false,
      config: {
        HTTPEnable: 1,
        HTTPProxy: 'corp.example',
        HTTPPort: 3128,
        HTTPUser: 'user',
        HTTPAuthEnable: 1,
        ProxyAutoConfigEnable: 1,
        ProxyAutoConfigURLString: 'https://corp.example/proxy.pac',
        ExceptionsList: ['*.local'],
      },
    },
  ];
  const original = structuredClone(services);
  const adapter = async (input) => {
    if (input.command === 'read') return { services: structuredClone(services) };
    for (const c of input.changes) {
      const s = services.find((s) => s.id === c.id);
      assert.deepEqual({ enabled: s.enabled, config: s.config }, c.expected);
      Object.assign(s, structuredClone(c.desired));
    }
    return { ok: true };
  };
  const manager = new SystemProxy(dir, { platform: 'darwin', adapter });
  await manager.enable({ proxyPort: 8080, socksPort: 1080, socksEnabled: true });
  assert.equal(services[0].config.HTTPProxy, '127.0.0.1');
  assert.ok(fs.existsSync(manager.file));
  const recovered = new SystemProxy(dir, { platform: 'darwin', adapter });
  await recovered.restore();
  assert.deepEqual(services, original);
  assert.equal(fs.existsSync(manager.file), false);
  await manager.restore();
});
test('proxy restore preserves external changes and releases remaining Glasses endpoints', async () => {
  let services = [{ id: 'wifi', name: 'Wi-Fi', enabled: true, config: {} }];
  const adapter = async (input) => {
    if (input.command === 'read') return { services };
    for (const c of input.changes) Object.assign(services[0], structuredClone(c.desired));
    return { ok: true };
  };
  const manager = new SystemProxy(dir, { platform: 'darwin', adapter });
  await manager.enable({ proxyPort: 8080, socksPort: 1080, socksEnabled: true });
  services[0].config.HTTPProxy = 'new-corporate.example';
  await manager.restore();
  assert.equal(services[0].config.HTTPProxy, 'new-corporate.example');
  assert.equal(services[0].config.HTTPSProxy, undefined);
  assert.equal(services[0].config.SOCKSProxy, undefined);
  assert.equal(manager.status().active, false);
  assert.equal(fs.existsSync(manager.file), false);
  assert.ok(fs.existsSync(path.join(dir, 'system-proxy-last-recovery.json')));
});
test('custom CA validates key pairing and usage, persists privately, and can revert', () => {
  const orgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-org-ca-'));
  const org = new Certificates(orgDir);
  const key = fs.readFileSync(org.keyPath, 'utf8');
  const info = certs.import(org.pem, key);
  assert.equal(info.source, 'custom');
  assert.equal(
    new crypto.X509Certificate(certs.leaf('internal.example').cert).verify(
      new crypto.X509Certificate(org.pem).publicKey,
    ),
    true,
  );
  const reload = new Certificates(dir);
  assert.equal(reload.info().fingerprint, info.fingerprint);
  assert.equal(fs.statSync(certs.customPath).mode & 0o777, 0o600);
  assert.throws(
    () => certs.import(org.pem, fs.readFileSync(certs.keyPath, 'utf8')),
    /does not match/,
  );
  assert.throws(() => certs.import(org.leaf('localhost').cert, key), /not a CA/);
  certs.useLocal();
  assert.equal(certs.info().source, 'local');
  assert.equal(fs.existsSync(certs.customPath), false);
  fs.rmSync(orgDir, { recursive: true, force: true });
});
test('relay credentials are encrypted separately and unavailable to public settings', () => {
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('encrypted:' + s.split('').reverse().join('')),
    decryptString: (b) => b.toString().slice(10).split('').reverse().join(''),
  };
  const store = new Secrets(dir, storage);
  const id = crypto.randomUUID();
  store.update([{ id, password: 'private-value' }]);
  assert.equal(store.get(id), 'private-value');
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes('private-value'));
  store.update([{ id }]);
  assert.equal(store.get(id), 'private-value');
  store.update([{ id, password: '' }]);
  assert.equal(store.get(id), '');
});

test('HTTPS relay verifies its certificate before forwarding traffic', async () => {
  const proxy = https.createServer(certs.leaf('localhost'), (req, res) =>
    relay.emit('request', req, res),
  );
  proxy.on('connect', (req, client, head) => relay.emit('connect', req, client, head));
  const port = await listen(proxy);
  try {
    settings.value.relayEnabled = true;
    settings.value.relayHops = [{ ...hop('https', port), host: 'localhost' }];
    const r = await engine.replay({
      url: `https://localhost:${ports.secure}/nested-tls`,
      method: 'GET',
      headers: {},
    });
    assert.equal(r.status, 200);
    const r2 = await request(`http://127.0.0.1:${ports.origin}/secure-proxy`);
    assert.equal(r2.status, 200);
  } finally {
    settings.value.relayEnabled = false;
    settings.value.relayHops = [];
    proxy.closeAllConnections();
    await new Promise((r) => proxy.close(r));
  }
});

test('SOCKS5 username/password negotiation supports fragmented responses', async () => {
  const connections = new Set();
  let seen;
  const proxy = net.createServer((client) => {
    connections.add(client);
    client.on('error', () => {});
    let state = 'hello',
      buffer = Buffer.alloc(0),
      peer;
    client.on('close', () => {
      connections.delete(client);
      peer?.destroy();
    });
    const parse = (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (state === 'hello') {
        if (buffer.length < 3) return;
        assert.deepEqual([...buffer.subarray(0, 3)], [5, 1, 2]);
        buffer = buffer.subarray(3);
        state = 'auth';
        client.write(Buffer.from([5]));
        setImmediate(() => client.write(Buffer.from([2])));
      }
      if (state === 'auth') {
        if (buffer.length < 3) return;
        const n = buffer[1];
        if (buffer.length < 3 + n) return;
        const p = buffer[2 + n];
        if (buffer.length < 3 + n + p) return;
        seen = {
          user: buffer.subarray(2, 2 + n).toString(),
          pass: buffer.subarray(3 + n, 3 + n + p).toString(),
        };
        buffer = buffer.subarray(3 + n + p);
        state = 'connect';
        client.write(Buffer.from([1, 0]));
      }
      if (state === 'connect') {
        if (buffer.length < 10) return;
        assert.equal(buffer[3], 1);
        const host = [...buffer.subarray(4, 8)].join('.'),
          port = buffer.readUInt16BE(8);
        buffer = buffer.subarray(10);
        state = 'tunnel';
        client.removeListener('data', parse);
        peer = net.connect({ host, port });
        peer.on('error', () => client.destroy());
        peer.once('connect', () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (buffer.length) peer.write(buffer);
          client.pipe(peer);
          peer.pipe(client);
        });
      }
    };
    client.on('data', parse);
  });
  const port = await listen(proxy),
    h = { ...hop('socks5', port), username: 'analyst', hasPassword: true };
  const router = new Router(
    { value: { relayEnabled: true, relayHops: [h], timeoutSeconds: 5 } },
    { password: () => 's3cret' },
  );
  try {
    const socket = await router.connect('127.0.0.1', ports.origin);
    assert.deepEqual(seen, { user: 'analyst', pass: 's3cret' });
    socket.destroy();
  } finally {
    for (const c of connections) c.destroy();
    await new Promise((r) => proxy.close(r));
  }
});

test('a failed system proxy apply rolls back before reporting failure', async () => {
  let services = [
    { id: 'wifi', name: 'Wi-Fi', enabled: true, config: { ExceptionsList: ['localhost'] } },
  ];
  const original = structuredClone(services);
  let writes = 0;
  const adapter = async (input) => {
    if (input.command === 'read') return { services: structuredClone(services) };
    for (const c of input.changes) Object.assign(services[0], structuredClone(c.desired));
    if (++writes === 1) throw new Error('Simulated apply failure');
    return { ok: true };
  };
  const manager = new SystemProxy(dir, { platform: 'darwin', adapter });
  await assert.rejects(
    manager.enable({ proxyPort: 8080, socksPort: 1080, socksEnabled: true }),
    /apply failure/,
  );
  assert.deepEqual(services, original);
  assert.equal(fs.existsSync(manager.file), false);
});

test('encrypted intermediate CA import sends the issuer chain and caps leaf expiry', () => {
  const pair = forge.pki.rsa.generateKeyPair(2048),
    ca = forge.pki.createCertificate();
  ca.publicKey = pair.publicKey;
  ca.serialNumber = '012345';
  ca.validity.notBefore = new Date(Date.now() - 10000);
  ca.validity.notAfter = new Date(Date.now() + 86400000);
  ca.setSubject([{ name: 'commonName', value: 'Organization Issuing CA' }]);
  ca.setIssuer(certs.cert.subject.attributes);
  ca.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, critical: true },
  ]);
  ca.sign(certs.key, forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(ca) + certs.pem;
  const key = crypto
    .createPrivateKey(forge.pki.privateKeyToPem(pair.privateKey))
    .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'test-passphrase' });
  try {
    certs.import(pem, key, 'test-passphrase');
    const leaf = certs.leaf('org.example');
    assert.equal((leaf.cert.match(/BEGIN CERTIFICATE/g) || []).length, 3);
    assert.ok(
      Date.parse(new crypto.X509Certificate(leaf.cert).validTo) <= ca.validity.notAfter.getTime(),
    );
    assert.throws(() => certs.validate(pem, key, 'wrong'));
  } finally {
    certs.useLocal();
  }
});

test('excluded TLS server names cannot be intercepted through an alternate CONNECT hostname', async () => {
  settings.value.bypassList = 'localhost';
  engine.clear();
  try {
    await assert.rejects(
      new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port: engine.port,
          method: 'CONNECT',
          path: `127.0.0.1:${ports.secure}`,
        });
        req.once('error', reject);
        req.once('connect', (_, socket) => {
          const secure = tls.connect({ socket, servername: 'localhost', ca: certs.pem });
          secure.once('secureConnect', () => {
            secure.destroy();
            resolve();
          });
          secure.once('error', reject);
        });
        req.end();
      }),
    );
    assert.equal(engine.records.size, 0);
  } finally {
    settings.value.bypassList = '';
  }
});

test('normalized macOS fields and disabled services do not lock restoration', async () => {
  let services = [
    {
      id: 'wifi',
      name: 'Wi-Fi',
      enabled: true,
      serviceEnabled: true,
      active: true,
      config: { HTTPEnable: 1, HTTPProxy: 'corp.example', HTTPPort: 3128 },
    },
  ];
  const adapter = async (input) => {
    if (input.command === 'read') return { services };
    for (const c of input.changes)
      Object.assign(
        services.find((s) => s.id === c.id),
        structuredClone(c.desired),
      );
    return { ok: true };
  };
  const manager = new SystemProxy(dir, { platform: 'darwin', adapter });
  await manager.enable({ proxyPort: 8080, socksPort: 1080, socksEnabled: true });
  for (const key of [
    'HTTPUser',
    'HTTPPassword',
    'HTTPAuthEnable',
    'HTTPSUser',
    'HTTPSPassword',
    'HTTPSAuthEnable',
    'SOCKSUser',
    'SOCKSPassword',
    'SOCKSAuthEnable',
  ])
    delete services[0].config[key];
  services[0].serviceEnabled = false;
  services[0].active = false;
  await manager.restore();
  assert.equal(services[0].config.HTTPProxy, 'corp.example');
  assert.equal(services[0].config.HTTPSProxy, undefined);
  assert.equal(manager.status().active, false);
});
