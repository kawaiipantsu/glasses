const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const net = require('node:net');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { z } = require('zod');
const { applyRules } = require('./plugins.cjs');
const { Router, Bypass } = require('./routing.cjs');
const { createSocks } = require('./socks.cjs');
const headerSchema = z.record(
  z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
  z
    .union([z.string().max(16384), z.array(z.string().max(16384)).max(100)])
    .refine((v) => !(Array.isArray(v) ? v : [v]).some((x) => /[\r\n\0]/.test(x))),
);
const requestSchema = z.object({
  url: z
    .string()
    .url()
    .max(16384)
    .refine(
      (v) => /^https?:\/\//.test(v) && !new URL(v).username && !new URL(v).password,
      'Use an HTTP(S) URL without credentials',
    ),
  method: z.string().regex(/^[A-Z]{1,20}$/),
  headers: headerSchema,
  body: z
    .string()
    .max(24 * 1024 * 1024)
    .default(''),
  bodyEncoding: z.enum(['utf8', 'base64']).default('utf8'),
});
function cleanHeaders(input) {
  const out = Object.create(null);
  for (const [k, v] of Object.entries(input || {})) if (v !== undefined) out[k.toLowerCase()] = v;
  const connection = String(out.connection || '')
    .toLowerCase()
    .split(',')
    .map((x) => x.trim());
  for (const key of [
    ...connection,
    'connection',
    'proxy-connection',
    'keep-alive',
    'proxy-authorization',
    'proxy-authenticate',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ])
    delete out[key];
  return out;
}
const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
class Engine extends EventEmitter {
  constructor(settings, certificates, plugins) {
    super();
    this.settings = settings;
    this.certificates = certificates;
    this.plugins = plugins;
    this.records = new Map();
    this.pending = new Map();
    this.sockets = new Set();
    this.jobs = new Map();
    this.rules = [];
    this.running = false;
    this.intercept = false;
    this.sequence = 0;
    this.bodyBytes = 0;
    this.router = new Router(settings, {
      ca: () => [
        ...tls.rootCertificates,
        ...(tls.getCACertificates?.('system') || []),
        certificates.pem,
      ],
      guard: (host, port) => this.guard(host, port),
    });
  }
  guard(host, port) {
    if (
      this.running &&
      [this.port, this.socks?.address()?.port].includes(Number(port)) &&
      ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(host)
    )
      throw new Error('A request cannot target a Glasses listener itself');
  }
  async excluded(host) {
    return new Bypass(this.settings.value.bypassList).matches(host);
  }
  disconnect() {
    for (const item of this.pending.values())
      item.reject(new Error('Routing settings changed; request dropped'));
    for (const id of this.jobs.keys()) this.cancelJob(id);
    for (const socket of this.sockets) socket.destroy();
    this.socks?.disconnect();
  }
  status() {
    return {
      running: this.running,
      intercept: this.intercept,
      pending: this.pending.size,
      proxyPort: this.port || this.settings.value.proxyPort,
      socksPort: this.socks?.address()?.port || this.settings.value.socksPort,
      socksEnabled: this.running && Boolean(this.socks),
      count: this.records.size,
    };
  }
  publish(record) {
    if (record.private) return;
    this.emit('record', { ...record });
  }
  trim() {
    while (
      this.records.size > this.settings.value.maxSessions ||
      this.bodyBytes > 128 * 1024 * 1024
    ) {
      const candidate = [...this.records.values()].find(
        (r) => !['pending', 'intercepted'].includes(r.state),
      );
      if (!candidate) break;
      this.bodyBytes -=
        (candidate.requestBody?.length || 0) + (candidate.responseBody?.length || 0);
      this.records.delete(candidate.id);
      this.emit('removed', candidate.id);
    }
  }
  create(input) {
    const record = {
      id: crypto.randomUUID(),
      number: ++this.sequence,
      startedAt: new Date().toISOString(),
      state: 'pending',
      status: 0,
      requestHeaders: {},
      responseHeaders: {},
      requestBody: '',
      responseBody: '',
      requestBytes: 0,
      responseBytes: 0,
      duration: 0,
      timings: {},
      source: 'proxy',
      appliedRules: [],
      ...input,
    };
    this.records.set(record.id, record);
    this.trim();
    this.publish(record);
    return record;
  }
  track(socket) {
    this.sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => this.sockets.delete(socket));
  }
  async start(override = {}) {
    if (this.starting) return this.starting;
    this.starting = this.startInternal(override);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }
  async startInternal(override = {}) {
    if (this.running) return this.status();
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.headersTimeout = 30000;
    this.server.requestTimeout = 120000;
    this.server.on('connection', (socket) => this.track(socket));
    this.server.on('clientError', (_, socket) => socket.destroy());
    this.tlsServer = http.createServer((req, res) => this.handle(req, res));
    this.tlsServer.on('tlsClientError', () => {});
    this.tlsServer.on('clientError', (_, socket) => socket.destroy());
    this.server.on('connect', async (req, socket, head) => {
      try {
        const target = new URL(`https://${req.url}`);
        const host = target.hostname.replace(/^\[|\]$/g, '');
        if (!host || target.username || target.password) throw new Error('Invalid CONNECT');
        this.guard(host, Number(target.port) || 443);
        if (await this.excluded(host)) {
          const peer = await this.router.connect(host, Number(target.port) || 443);
          if (socket.destroyed) {
            peer.destroy();
            return;
          }
          this.track(peer);
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) peer.write(head);
          socket.pipe(peer);
          peer.pipe(socket);
          socket.once('close', () => peer.destroy());
          peer.once('close', () => socket.destroy());
          return;
        }
        socket.glassesTarget = target.host;
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) socket.unshift(head);
        // A per-connection context also supports TLS clients which omit SNI (IP addresses).
        const secured = new tls.TLSSocket(socket, {
          isServer: true,
          secureContext: this.certificates.leaf(host).context,
          ALPNProtocols: ['http/1.1'],
          SNICallback: (name, cb) => {
            void this.excluded(name)
              .then((excluded) => {
                if (excluded) throw new Error('TLS server name is on the privacy bypass list');
                cb(null, this.certificates.leaf(name).context);
              })
              .catch(cb);
          },
        });
        secured.glassesTarget = target.host;
        secured.on('error', () => socket.destroy());
        this.track(secured);
        this.tlsServer.emit('connection', secured);
      } catch {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      }
    });
    // Upgrade tunnels preserve WebSocket traffic; semantic frames are a follow-up capability.
    const upgrade = (req, socket, head) => {
      void this.upgrade(req, socket, head).catch(() => socket.destroy());
    };
    this.server.on('upgrade', upgrade);
    this.tlsServer.on('upgrade', upgrade);
    try {
      await listen(this.server, override.proxyPort ?? this.settings.value.proxyPort);
      this.port = this.server.address().port;
      if (override.socksEnabled ?? this.settings.value.socksEnabled) {
        this.socks = createSocks(
          async ({ host, port, started }) => {
            if (await this.excluded(host)) return null;
            const r = this.create({
              method: 'CONNECT',
              url: `socks5://${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`,
              source: 'socks',
              protocol: 'SOCKS5',
            });
            return (event, data) => {
              if (event === 'error') {
                r.error = data;
                r.state = 'error';
              } else {
                r.state = r.error ? 'error' : 'complete';
                r.requestBytes = data.sent;
                r.responseBytes = data.received;
                r.duration = Date.now() - started;
              }
              this.publish(r);
            };
          },
          (host, port, signal) => this.router.connect(host, port, { signal }),
        );
        await listen(this.socks, override.socksPort ?? this.settings.value.socksPort);
      }
      this.running = true;
      this.emit('status', this.status());
      return this.status();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  async stop() {
    this.intercept = false;
    for (const item of this.pending.values()) item.reject(new Error('Proxy stopped'));
    this.pending.clear();
    for (const id of this.jobs.keys()) this.cancelJob(id);
    for (const socket of this.sockets) socket.destroy();
    if (this.socks) {
      await this.socks.shutdown();
      this.socks = null;
    }
    if (this.server?.listening) await new Promise((resolve) => this.server.close(resolve));
    this.running = false;
    this.emit('status', this.status());
    return this.status();
  }
  setIntercept(enabled) {
    this.intercept = Boolean(enabled);
    if (!enabled)
      for (const id of [...this.pending.keys()])
        void this.resolveIntercept(id, { action: 'forward' }).catch(() => {});
    this.emit('status', this.status());
    return this.status();
  }
  async pause(record, phase) {
    const s = this.settings.value;
    if (
      !this.intercept ||
      (s.interceptPhase !== phase && s.interceptPhase !== 'both') ||
      (s.interceptFilter && !record.url.includes(s.interceptFilter))
    )
      return;
    if (this.pending.size >= 100) throw new Error('Intercept queue full');
    record.state = 'intercepted';
    record.interceptPhase = phase;
    await new Promise((resolve, reject) => {
      const finish = (fn) => (value) => {
        clearTimeout(timer);
        this.pending.delete(record.id);
        record.interceptPhase = undefined;
        this.emit('status', this.status());
        fn(value);
      };
      const timer = setTimeout(() => {
        const entry = this.pending.get(record.id);
        entry?.reject(new Error('Interception timed out; request dropped'));
      }, s.interceptTimeoutSeconds * 1000);
      this.pending.set(record.id, {
        record,
        phase,
        resolve: finish(resolve),
        reject: finish(reject),
      });
      this.publish(record);
      this.emit('status', this.status());
    });
    record.state = 'pending';
    this.publish(record);
  }
  async resolveIntercept(id, edit) {
    const item = this.pending.get(id);
    if (!item) throw new Error('This interception is no longer pending');
    if (edit.action === 'drop') {
      item.reject(new Error('Dropped by researcher'));
      return;
    }
    if (edit.action !== 'forward') throw new Error('Unknown intercept action');
    if (edit.request && item.phase === 'request') {
      const value = requestSchema.parse(edit.request);
      if (await this.excluded(new URL(value.url).hostname))
        throw new Error('Destination is on the privacy bypass list');
      if (this.pending.get(id) !== item) throw new Error('This interception is no longer pending');
      const body = Buffer.from(value.body, value.bodyEncoding);
      if (body.length > this.settings.value.bodyLimitMB * 1024 * 1024)
        throw new Error('Request body exceeds limit');
      Object.assign(item.record, {
        url: value.url,
        method: value.method,
        requestHeaders: cleanHeaders(value.headers),
        requestBody: body.toString('base64'),
        requestBytes: body.length,
      });
    }
    if (edit.response && item.phase === 'response') {
      const value = z
        .object({
          status: z.number().int().min(200).max(599),
          headers: headerSchema,
          body: z.string().max(24 * 1024 * 1024),
          bodyEncoding: z.enum(['utf8', 'base64']),
        })
        .parse(edit.response);
      const body = Buffer.from(value.body, value.bodyEncoding);
      if (body.length > this.settings.value.bodyLimitMB * 1024 * 1024)
        throw new Error('Response exceeds limit');
      Object.assign(item.record, {
        status: value.status,
        responseHeaders: cleanHeaders(value.headers),
        responseBody: body.toString('base64'),
        responseBytes: body.length,
      });
      delete item.record.responseHeaders['content-encoding'];
    }
    item.resolve();
  }
  urlFor(req) {
    return /^https?:\/\//i.test(req.url)
      ? req.url
      : `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host || req.socket.glassesTarget}${req.url}`;
  }
  async handle(req, res) {
    let record;
    try {
      const url = this.urlFor(req);
      requestSchema.parse({ url, method: req.method, headers: req.headers });
      if (await this.excluded(new URL(url).hostname))
        return await this.forwardPrivate(req, res, new URL(url));
      record = this.create({
        url,
        method: req.method,
        requestHeaders: cleanHeaders(req.headers),
        protocol: req.socket.encrypted ? 'HTTPS' : 'HTTP',
      });
      const chunks = [];
      let size = 0;
      const limit = this.settings.value.bodyLimitMB * 1024 * 1024;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) {
          res.writeHead(413);
          res.end('Request body exceeds configured capture limit');
          throw new Error('Request body exceeds configured limit');
        }
        chunks.push(chunk);
      }
      record.requestBody = Buffer.concat(chunks).toString('base64');
      record.requestBytes = size;
      await this.pause(record, 'request');
      await this.perform(record, res);
    } catch (error) {
      if (record) {
        record.error = error.message;
        record.state = 'error';
        this.publish(record);
      }
      if (!res.headersSent && !res.destroyed) res.writeHead(502, { 'content-type': 'text/plain' });
      if (!res.destroyed) res.end(`Glasses: ${error.message}`);
    }
  }
  async forwardPrivate(req, res, target) {
    const headers = cleanHeaders(req.headers);
    headers.host = target.host;
    const connectionAbort = new AbortController();
    const upstream = (target.protocol === 'https:' ? https : http).request(target, {
      method: req.method,
      ...this.router.requestOptions(target, headers, connectionAbort.signal),
      timeout: this.settings.value.timeoutSeconds * 1000,
    });
    const timer = setTimeout(
      () => upstream.destroy(new Error('Request deadline exceeded')),
      this.settings.value.timeoutSeconds * 1000,
    );
    return new Promise((resolve, reject) => {
      upstream.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      upstream.once('response', (response) => {
        res.writeHead(response.statusCode, cleanHeaders(response.headers));
        response.pipe(res);
        response.once('end', () => {
          clearTimeout(timer);
          resolve();
        });
        response.once('error', reject);
      });
      res.once('close', () => {
        clearTimeout(timer);
        connectionAbort.abort();
        upstream.destroy();
      });
      req.once('error', (error) => upstream.destroy(error));
      req.pipe(upstream);
    });
  }
  async perform(record, downstream, job) {
    const target = new URL(record.url);
    const started = performance.now();
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
    if (
      this.running &&
      localHost &&
      Number(target.port || (target.protocol === 'https:' ? 443 : 80)) === this.port
    ) {
      record.state = 'error';
      record.error = 'A request cannot target the proxy listener itself';
      this.publish(record);
      throw new Error(record.error);
    }
    const body = Buffer.from(record.requestBody || '', 'base64');
    const headers = cleanHeaders(record.requestHeaders);
    delete headers['content-length'];
    headers.host = target.host;
    if (body.length || ['POST', 'PUT', 'PATCH'].includes(record.method))
      headers['content-length'] = String(body.length);
    record.appliedRules.push(
      ...applyRules([...this.rules, ...this.plugins.rules()], 'request', record, headers),
    );
    record.requestHeaders = headers;
    const limit = this.settings.value.bodyLimitMB * 1024 * 1024;
    return new Promise((resolve, reject) => {
      const connectionAbort = new AbortController();
      let done = false;
      const fail = (error) => {
        if (done) return;
        done = true;
        clearTimeout(deadline);
        connectionAbort.abort();
        job?.requests.delete(request);
        record.state = 'error';
        record.error = error.message;
        record.duration = Math.round(performance.now() - started);
        this.publish(record);
        reject(error);
      };
      const request = (target.protocol === 'https:' ? https : http).request(target, {
        method: record.method,
        ...this.router.requestOptions(target, headers, connectionAbort.signal, (phase) => {
          record.timings[phase] = Math.round(performance.now() - started);
        }),
        timeout: this.settings.value.timeoutSeconds * 1000,
        ca: [...tls.rootCertificates, this.certificates.pem],
      });
      const deadline = setTimeout(
        () => request.destroy(new Error('Request deadline exceeded')),
        this.settings.value.timeoutSeconds * 1000,
      );
      job?.requests.add(request);
      if (job?.cancelled) request.destroy(new Error('Run cancelled'));
      downstream?.once('close', () => {
        if (!downstream.writableEnded) request.destroy(new Error('Client disconnected'));
      });
      request.once('socket', (socket) => {
        this.track(socket);
        record.timings.connect ??= Math.round(performance.now() - started);
        if (socket.encrypted) {
          record.timings.tls ??= record.timings.connect;
          record.tls = {
            protocol: socket.getProtocol(),
            cipher: socket.getCipher()?.name,
            authorized: socket.authorized,
          };
        }
        const t = () => Math.round(performance.now() - started);
        socket.once('lookup', () => (record.timings.dns = t()));
        socket.once('connect', () => {
          record.timings.connect = t();
          if (
            this.running &&
            socket.remotePort === this.port &&
            ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.remoteAddress)
          )
            request.destroy(new Error('A request cannot target the proxy listener itself'));
        });
        socket.once('secureConnect', () => {
          record.timings.tls = t();
          record.tls = {
            protocol: socket.getProtocol(),
            cipher: socket.getCipher()?.name,
            authorized: socket.authorized,
          };
        });
      });
      request.once('timeout', () => request.destroy(new Error('Upstream timeout')));
      request.once('error', fail);
      request.once('response', async (response) => {
        try {
          record.timings.firstByte = Math.round(performance.now() - started);
          record.status = response.statusCode;
          record.responseHeaders = cleanHeaders(response.headers);
          record.appliedRules.push(
            ...applyRules(
              [...this.rules, ...this.plugins.rules()],
              'response',
              record,
              record.responseHeaders,
            ),
          );
          let shouldPause =
            this.intercept &&
            ['response', 'both'].includes(this.settings.value.interceptPhase) &&
            (!this.settings.value.interceptFilter ||
              record.url.includes(this.settings.value.interceptFilter));
          let size = 0,
            captured = 0;
          const chunks = [];
          let sent = false;
          const begin = () => {
            if (downstream && !sent && !downstream.destroyed) {
              const h = cleanHeaders(record.responseHeaders);
              delete h['content-length'];
              downstream.writeHead(record.status, h);
              sent = true;
            }
          };
          if (!shouldPause) begin();
          for await (const chunk of response) {
            size += chunk.length;
            if (captured < limit) {
              const part = chunk.subarray(0, limit - captured);
              chunks.push(part);
              captured += part.length;
            }
            if (shouldPause && size > limit) {
              shouldPause = false;
              record.note = 'Response exceeds capture limit; forwarded without pausing';
              begin();
              if (downstream) {
                const prior = Buffer.concat(chunks);
                downstream.write(prior);
                const excess = size - limit;
                if (excess > 0) downstream.write(chunk.subarray(chunk.length - excess));
              }
            } else if (!shouldPause && downstream && !downstream.destroyed) {
              if (!downstream.write(chunk))
                await new Promise((r) => {
                  const finish = () => {
                    downstream.removeListener('drain', finish);
                    downstream.removeListener('close', finish);
                    r();
                  };
                  downstream.once('drain', finish);
                  downstream.once('close', finish);
                });
            }
          }
          record.responseBytes = size;
          record.responseBody = Buffer.concat(chunks).toString('base64');
          record.truncated = size > limit;
          record.timings.end = Math.round(performance.now() - started);
          record.duration = record.timings.end;
          clearTimeout(deadline);
          job?.requests.delete(request);
          if (shouldPause) {
            await this.pause(record, 'response');
            begin();
            downstream?.end(Buffer.from(record.responseBody, 'base64'));
          } else downstream?.end();
          record.state = 'complete';
          this.bodyBytes += record.requestBody.length + record.responseBody.length;
          this.trim();
          this.publish(record);
          done = true;
          resolve(record);
        } catch (e) {
          request.destroy();
          fail(e);
        }
      });
      request.end(body);
    });
  }
  async replay(input, job) {
    input = requestSchema.parse(input);
    if (await this.excluded(new URL(input.url).hostname))
      throw new Error(
        'Destination is on the privacy bypass list. Remove it before inspecting or replaying it.',
      );
    const body = Buffer.from(input.body, input.bodyEncoding);
    if (body.length > this.settings.value.bodyLimitMB * 1024 * 1024)
      throw new Error('Request body exceeds configured limit');
    const r = this.create({
      url: input.url,
      method: input.method,
      requestHeaders: input.headers,
      requestBody: body.toString('base64'),
      requestBytes: body.length,
      source: 'repeater',
      protocol: input.url.startsWith('https:') ? 'HTTPS' : 'HTTP',
    });
    return this.perform(r, null, job);
  }
  run(input) {
    const spec = z
      .object({
        request: requestSchema,
        iterations: z.number().int().min(1).max(1000),
        concurrency: z.number().int().min(1).max(10),
        delayMs: z.number().int().min(0).max(60000),
        payloads: z.array(z.string().max(16384)).max(1000),
      })
      .parse(input);
    const id = crypto.randomUUID(),
      job = {
        id,
        cancelled: false,
        completed: 0,
        total: spec.iterations,
        results: [],
        requests: new Set(),
        waiters: new Set(),
      };
    this.jobs.set(id, job);
    const publicJob = () => ({
      id,
      cancelled: job.cancelled,
      completed: job.completed,
      total: job.total,
      results: job.results,
      done: job.done || false,
    });
    let index = 0;
    const worker = async () => {
      while (!job.cancelled) {
        const i = index++;
        if (i >= spec.iterations) return;
        const payload = spec.payloads.length ? spec.payloads[i % spec.payloads.length] : '';
        const replace = (s) =>
          s.replaceAll('{{payload}}', payload).replaceAll('{{iteration}}', String(i + 1));
        try {
          const req = {
            ...spec.request,
            url: replace(spec.request.url),
            body: replace(spec.request.body),
            headers: Object.fromEntries(
              Object.entries(spec.request.headers).map(([k, v]) => [
                k,
                Array.isArray(v) ? v.map(replace) : replace(v),
              ]),
            ),
          };
          const result = await this.replay(req, job);
          job.results.push({
            iteration: i + 1,
            payload,
            recordId: result.id,
            status: result.status,
            bytes: result.responseBytes,
            duration: result.duration,
          });
        } catch (error) {
          job.results.push({ iteration: i + 1, payload, error: error.message });
        }
        job.completed++;
        this.emit('job', publicJob());
        if (spec.delayMs && !job.cancelled)
          await new Promise((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              job.waiters.delete(finish);
              resolve();
            };
            const timer = setTimeout(finish, spec.delayMs);
            job.waiters.add(finish);
          });
      }
    };
    Promise.all(Array.from({ length: spec.concurrency }, worker)).finally(() => {
      job.done = true;
      this.emit('job', publicJob());
      setTimeout(() => this.jobs.delete(id), 60000).unref();
    });
    return publicJob();
  }
  cancelJob(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.cancelled = true;
    for (const wake of job.waiters) wake();
    for (const req of job.requests) req.destroy(new Error('Run cancelled'));
  }
  clear() {
    if (this.pending.size) throw new Error('Forward or drop intercepted traffic before clearing');
    this.records.clear();
    this.bodyBytes = 0;
    this.emit('clear');
  }
  async upgrade(req, socket, head) {
    let target;
    try {
      target = new URL(this.urlFor(req));
    } catch {
      return socket.destroy();
    }
    let excluded;
    try {
      excluded = await this.excluded(target.hostname);
    } catch {
      return socket.destroy();
    }
    const record = excluded
      ? { private: true }
      : this.create({
          url: target.href,
          method: 'GET',
          requestHeaders: req.headers,
          protocol: 'WebSocket',
          note: 'Upgrade tunnel; individual frames are not inspected in 0.1',
        });
    const secure = target.protocol === 'https:';
    const started = Date.now();
    const upstream = (secure ? https : http).request(target, {
      ...this.router.requestOptions(target, {
        ...cleanHeaders(req.headers),
        connection: 'Upgrade',
        upgrade: req.headers.upgrade,
      }),
      timeout: 30000,
      ca: [...tls.rootCertificates, this.certificates.pem],
    });
    upstream.on('timeout', () => upstream.destroy(new Error('WebSocket handshake timed out')));
    upstream.on('error', (e) => {
      record.error = e.message;
      record.state = 'error';
      this.publish(record);
      socket.destroy();
    });
    upstream.on('response', (res) => {
      record.status = res.statusCode;
      record.responseHeaders = res.headers;
      record.state = 'complete';
      this.publish(record);
      socket.end(`HTTP/1.1 ${res.statusCode} Upgrade rejected\r\nContent-Length: 0\r\n\r\n`);
      res.resume();
    });
    upstream.on('upgrade', (res, peer, upstreamHead) => {
      this.track(peer);
      record.status = res.statusCode;
      record.responseHeaders = res.headers;
      record.state = 'tunnel';
      this.publish(record);
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(res.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n')}\r\n\r\n`,
      );
      if (head.length) peer.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      socket.pipe(peer);
      peer.pipe(socket);
      socket.on('close', () => {
        peer.destroy();
        record.state = 'complete';
        record.duration = Date.now() - started;
        this.publish(record);
      });
      peer.on('close', () => socket.destroy());
    });
    upstream.end();
  }
}
module.exports = { Engine, requestSchema, headerSchema, cleanHeaders };
