const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns').promises;
const { domainToASCII } = require('node:url');
const { z } = require('zod');
const normalizeHost = (value) => {
  const host = value
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (net.isIP(host) === 6) return new URL(`http://[${host}]`).hostname.slice(1, -1);
  return domainToASCII(host) || host;
};
function parseBypass(text) {
  const rules = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith('#'));
  if (rules.length > 500) throw new Error('Use at most 500 bypass entries');
  return rules.map((rule) => {
    if (rule.includes('/')) {
      const [ip, bits, extra] = rule.split('/');
      const family = net.isIP(ip);
      if (!family || extra || !/^\d+$/.test(bits) || Number(bits) > (family === 4 ? 32 : 128))
        throw new Error(`Invalid CIDR: ${rule}`);
      const list = new net.BlockList();
      list.addSubnet(ip, Number(bits), family === 4 ? 'ipv4' : 'ipv6');
      return { rule, list };
    }
    const wildcard = rule.startsWith('*.');
    const host = normalizeHost(wildcard ? rule.slice(2) : rule);
    if (
      !net.isIP(host) &&
      (!host ||
        host.length > 253 ||
        !host.split('.').every((s) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s)))
    )
      throw new Error(`Invalid host: ${rule}`);
    if (wildcard && net.isIP(host)) throw new Error(`Invalid wildcard: ${rule}`);
    return { rule, host, wildcard };
  });
}
const bypassSchema = z
  .string()
  .max(32768)
  .default('')
  .superRefine((v, ctx) => {
    try {
      parseBypass(v);
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: e.message });
    }
  });
const hopSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(['http', 'https', 'socks5']),
    host: z
      .string()
      .min(1)
      .max(253)
      .refine((h) => {
        try {
          const r = parseBypass(h);
          return r.length === 1 && !r[0].wildcard && !r[0].list && !/[\s/#]/.test(h);
        } catch {
          return false;
        }
      }, 'Enter a hostname or IP without a scheme or port'),
    port: z.number().int().min(1).max(65535),
    username: z
      .string()
      .max(255)
      .refine((v) => !/[\r\n\0:]/.test(v))
      .default(''),
    hasPassword: z.boolean().default(false),
  })
  .strict();
class Bypass {
  constructor(text, lookup = dns.lookup) {
    this.rules = parseBypass(text);
    this.lookup = lookup;
  }
  async matches(host) {
    host = normalizeHost(host);
    if (
      this.rules.some(
        (r) =>
          r.host &&
          ((host === r.host && !r.wildcard) || (r.wildcard && host.endsWith('.' + r.host))),
      )
    )
      return true;
    const ranges = this.rules.filter((r) => r.list);
    if (!ranges.length) return false;
    let addresses = [{ address: host }];
    if (!net.isIP(host)) {
      let timer;
      try {
        addresses = await Promise.race([
          this.lookup(host, { all: true }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Bypass DNS check timed out; request withheld')),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    return addresses.some(({ address }) =>
      ranges.some((r) => r.list.check(address, net.isIP(address) === 6 ? 'ipv6' : 'ipv4')),
    );
  }
}
function readHandshake(socket, complete, max = 32768) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      socket.pause();
      socket.off('data', data);
      socket.off('error', error);
      socket.off('end', end);
      socket.off('close', end);
    };
    const error = (e) => {
      cleanup();
      reject(e);
    };
    const end = () => error(new Error('Proxy closed during negotiation'));
    const data = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > max) return error(new Error('Proxy handshake exceeds limit'));
      try {
        const count = complete(buffer);
        if (!count) return;
        cleanup();
        if (buffer.length > count) socket.unshift(buffer.subarray(count));
        resolve(buffer.subarray(0, count));
      } catch (e) {
        error(e);
      }
    };
    socket.on('data', data);
    socket.once('error', error);
    socket.once('end', end);
    socket.once('close', end);
    socket.resume();
  });
}
const authority = (host, port) => `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
async function negotiate(socket, hop, host, port, password) {
  if (hop.type !== 'socks5') {
    const credentials =
      hop.username || password
        ? `Proxy-Authorization: Basic ${Buffer.from(`${hop.username}:${password}`).toString('base64')}\r\n`
        : '';
    const response = readHandshake(socket, (b) => {
      const i = b.indexOf('\r\n\r\n');
      return i < 0 ? 0 : i + 4;
    });
    socket.write(
      `CONNECT ${authority(host, port)} HTTP/1.1\r\nHost: ${authority(host, port)}\r\n${credentials}\r\n`,
    );
    const data = await response;
    const status = /^HTTP\/1\.[01] (\d{3})/.exec(data.toString('latin1'));
    if (!status || Number(status[1]) !== 200)
      throw new Error(`HTTP relay CONNECT refused (${status?.[1] || 'invalid response'})`);
    return;
  }
  const auth = Boolean(hop.username || password);
  let response = readHandshake(socket, (b) => (b.length >= 2 ? 2 : 0), 1024);
  socket.write(Buffer.from([5, 1, auth ? 2 : 0]));
  let data = await response;
  if (data[0] !== 5 || data[1] !== (auth ? 2 : 0))
    throw new Error('SOCKS5 relay rejected authentication method');
  if (auth) {
    const user = Buffer.from(hop.username),
      pass = Buffer.from(password);
    if (!user.length || user.length > 255 || !pass.length || pass.length > 255)
      throw new Error('SOCKS5 credentials must each be 1-255 UTF-8 bytes');
    response = readHandshake(socket, (b) => (b.length >= 2 ? 2 : 0), 1024);
    socket.write(
      Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]),
    );
    data = await response;
    if (data[0] !== 1 || data[1] !== 0) throw new Error('SOCKS5 relay authentication failed');
  }
  // Domain form keeps hostname resolution at the relay. Literal IPs are supported too.
  const encoded = Buffer.from(host);
  if (!encoded.length || encoded.length > 255) throw new Error('SOCKS5 target exceeds limit');
  const p = Buffer.alloc(2);
  p.writeUInt16BE(port);
  response = readHandshake(socket, (b) => {
    if (b.length < 5) return 0;
    if (b[0] !== 5 || b[1] !== 0 || b[2] !== 0)
      throw new Error(`SOCKS5 relay refused connection (${b[1]})`);
    const n = b[3] === 1 ? 10 : b[3] === 4 ? 22 : b[3] === 3 ? 7 + b[4] : -1;
    if (n < 0) throw new Error('Invalid SOCKS5 relay address');
    return b.length >= n ? n : 0;
  });
  let address;
  if (net.isIP(host) === 4) address = Buffer.from([1, ...host.split('.').map(Number)]);
  else if (net.isIP(host) === 6) {
    const expanded = host.split('::');
    const left = expanded[0] ? expanded[0].split(':') : [],
      right = expanded[1] ? expanded[1].split(':') : [];
    const parts =
      expanded.length === 2
        ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
        : left;
    const bytes = Buffer.alloc(17);
    bytes[0] = 4;
    parts.forEach((part, i) => bytes.writeUInt16BE(parseInt(part, 16), 1 + i * 2));
    address = bytes;
  } else address = Buffer.concat([Buffer.from([3, encoded.length]), encoded]);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, p]));
  await response;
}
class Router {
  constructor(settings, options = {}) {
    this.settings = settings;
    this.password = options.password || (() => '');
    this.ca = options.ca;
    this.guard = options.guard || (() => {});
  }
  hops() {
    const s = this.settings.value;
    return s.relayEnabled ? s.relayHops : [];
  }
  trust() {
    return this.ca?.() || tls.rootCertificates;
  }
  async connect(host, port, options = {}) {
    host = normalizeHost(host);
    this.guard(host, port);
    const hops = options.hops || this.hops();
    if (this.settings.value.relayEnabled && !hops.length && !options.hops)
      throw new Error('Relay enabled without any hops');
    for (const hop of hops) this.guard(normalizeHost(hop.host), hop.port);
    let socket, timer, abort;
    const deadline = this.settings.value.timeoutSeconds * 1000;
    const fail = (e) => socket?.destroy(e);
    try {
      if (options.signal?.aborted) throw new Error('Run cancelled');
      const first = hops[0] || { host, port };
      socket = net.connect({ host: normalizeHost(first.host), port: first.port });
      socket.on('error', () => {});
      socket.once('lookup', () => options.onTiming?.('dns'));
      timer = setTimeout(() => fail(new Error('Relay connection deadline exceeded')), deadline);
      abort = () => fail(new Error('Run cancelled'));
      options.signal?.addEventListener('abort', abort, { once: true });
      await new Promise((resolve, reject) => {
        socket.once('connect', () => {
          try {
            this.guard(socket.remoteAddress, socket.remotePort);
            options.onTiming?.('connect');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
        socket.once('error', reject);
      });
      for (let i = 0; i < hops.length; i++) {
        const hop = hops[i];
        if (hop.type === 'https') socket = await this.secure(socket, normalizeHost(hop.host));
        if (i === hops.length - 1 && options.forward) break;
        const next = hops[i + 1] || { host, port };
        try {
          await negotiate(socket, hop, normalizeHost(next.host), next.port, this.password(hop.id));
        } catch (e) {
          throw new Error(`Relay hop ${i + 1}: ${e.message}`);
        }
      }
      if (hops.length) options.onTiming?.('connect');
      if (options.tls) {
        socket = await this.secure(socket, host, options.inspect);
        options.onTiming?.('tls');
      }
      socket.resume();
      return socket;
    } catch (e) {
      socket?.destroy();
      throw e;
    } finally {
      clearTimeout(timer);
      if (abort) options.signal?.removeEventListener('abort', abort);
    }
  }
  secure(socket, host, inspect = false) {
    return new Promise((resolve, reject) => {
      const secured = tls.connect({
        socket,
        servername: net.isIP(host) ? undefined : host,
        host,
        rejectUnauthorized: !inspect,
        ca: this.trust(),
        ALPNProtocols: ['http/1.1'],
      });
      secured.on('error', () => {});
      secured.once('error', reject);
      secured.once('secureConnect', () => resolve(secured));
      secured.setTimeout(this.settings.value.timeoutSeconds * 1000, () =>
        secured.destroy(new Error('TLS relay handshake timed out')),
      );
    });
  }
  requestOptions(target, headers, signal, onTiming) {
    const http = require('node:http'),
      https = require('node:https');
    const hops = this.hops(),
      last = hops.at(-1);
    const secure = target.protocol === 'https:';
    const forward = !secure && last && last.type !== 'socks5';
    const agent = new (secure ? https.Agent : http.Agent)({ keepAlive: false });
    agent.createConnection = (_options, callback) => {
      this.connect(target.hostname, Number(target.port) || (secure ? 443 : 80), {
        forward,
        tls: secure,
        signal,
        onTiming,
      }).then((socket) => {
        callback(null, socket);
        socket.resume();
      }, callback);
    };
    const out = { ...headers };
    if (forward && (last.username || last.hasPassword))
      out['proxy-authorization'] =
        'Basic ' + Buffer.from(`${last.username}:${this.password(last.id)}`).toString('base64');
    return { agent, headers: out, path: forward ? target.href : target.pathname + target.search };
  }
}
module.exports = { Router, Bypass, parseBypass, bypassSchema, hopSchema, normalizeHost };
