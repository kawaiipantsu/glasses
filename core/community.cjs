const https = require('node:https');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { z } = require('zod');
const { pluginSchema } = require('./plugins.cjs');
const ORIGIN = 'https://glasses.thugs.red';
const BASE = `${ORIGIN}/api/v1`;
const MAX_PACKAGE = 262144;
const idSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
const versionSchema = z
  .string()
  .max(32)
  .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
const identitySchema = z.object({ id: idSchema, version: versionSchema }).strict();
const capsSchema = pluginSchema.shape.capabilities.refine((v) => new Set(v).size === v.length);
const KEY_ID = 'community-2026-01';
const publicKey = crypto.createPublicKey({
  key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from('tr6LkVRoOFO1kzFLg642gn1UEoRS1z8x4AHfXRtYd2M=', 'base64'),
  ]),
  format: 'der',
  type: 'spki',
});
const TRUSTED_KEYS = Object.freeze({ [KEY_ID]: publicKey });
const envelopeSchema = z
  .object({
    algorithm: z.literal('Ed25519'),
    keyId: z.string().max(80),
    payload: z.string().max(16000),
    signature: z.string().max(100),
  })
  .strict();
const descriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    packageId: idSchema,
    version: versionSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().min(1).max(MAX_PACKAGE),
    downloadUrl: z.string().max(400),
    capabilities: capsSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();
const entrySchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(1000),
  author: z.string().max(100),
  publisher: z.object({
    id: z.union([z.string().max(100), z.number().int()]),
    displayName: z.string().max(100),
  }),
  kind: z.enum(['plugin', 'extension']),
  version: versionSchema,
  capabilities: capsSchema,
  size: z.number().int().min(1).max(MAX_PACKAGE),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: z.string().max(60),
  releaseNotes: z.string().max(10000).optional(),
});
const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(entrySchema).max(100),
  pagination: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});
const querySchema = z
  .object({
    q: z.string().max(200).default(''),
    kind: z.enum(['', 'plugin', 'extension']).default(''),
    page: z.number().int().min(1).max(100000).default(1),
  })
  .strict();
function parseJson(bytes) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function base64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid community signature encoding');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value)
    throw new Error('Noncanonical community signature encoding');
  return decoded;
}
function packageUrl(identity, action) {
  const { id, version } = identitySchema.parse(identity);
  if (!['install', 'download'].includes(action)) throw new Error('Invalid package action');
  return `${BASE}/packages/${id}/versions/${version}/${action}`;
}
function parseInstallUri(raw) {
  if (typeof raw !== 'string' || raw.length > 512 || /[\s\x00-\x1f]/.test(raw))
    throw new Error('Invalid Glasses install link');
  const url = new URL(raw);
  if (
    url.protocol !== 'glasses:' ||
    url.hostname !== 'install' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new Error('Invalid Glasses install link');
  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== 2 ||
    keys.filter((x) => x === 'id').length !== 1 ||
    keys.filter((x) => x === 'version').length !== 1
  )
    throw new Error('Invalid Glasses install parameters');
  return identitySchema.parse({
    id: url.searchParams.get('id'),
    version: url.searchParams.get('version'),
  });
}
function verifyEnvelope(raw, identity, keys = TRUSTED_KEYS, now = Math.floor(Date.now() / 1000)) {
  identity = identitySchema.parse(identity);
  const envelope = envelopeSchema.parse(parseJson(raw));
  if (!Object.hasOwn(keys, envelope.keyId)) throw new Error('Unknown community signing key');
  const bytes = base64url(envelope.payload),
    signature = base64url(envelope.signature);
  if (signature.length !== 64 || !crypto.verify(null, bytes, keys[envelope.keyId], signature))
    throw new Error('Community signature verification failed');
  const d = descriptorSchema.parse(parseJson(bytes));
  if (
    d.packageId !== identity.id ||
    d.version !== identity.version ||
    d.downloadUrl !== packageUrl(identity, 'download')
  )
    throw new Error('Community package identity does not match');
  if (
    d.issuedAt > now + 60 ||
    d.expiresAt <= now ||
    d.expiresAt <= d.issuedAt ||
    d.expiresAt - d.issuedAt > 600 ||
    d.issuedAt < now - 660
  )
    throw new Error('Community install authorization expired or clock is incorrect');
  return { ...d, keyId: envelope.keyId };
}
function verifyPackage(bytes, descriptor) {
  if (
    bytes.length !== descriptor.size ||
    crypto.createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256
  )
    throw new Error('Community package checksum or size mismatch');
  const manifest = pluginSchema.parse(parseJson(bytes));
  if (
    manifest.id !== descriptor.packageId ||
    manifest.version !== descriptor.version ||
    new Set(manifest.capabilities).size !== manifest.capabilities.length ||
    [...manifest.capabilities].sort().join('\0') !== [...descriptor.capabilities].sort().join('\0')
  )
    throw new Error('Community manifest differs from signed metadata');
  return manifest;
}
function compareVersions(a, b) {
  const aa = versionSchema.parse(a).split('.').map(Number),
    bb = versionSchema.parse(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return Math.sign(aa[i] - bb[i]);
  return 0;
}
function fetchBytes(raw, maximum) {
  const url = new URL(raw);
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.startsWith('/api/v1/')
  )
    return Promise.reject(new Error('Community URL is outside the trusted service'));
  return new Promise((resolve, reject) => {
    let timer,
      request,
      failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      reject(error);
      request?.destroy(error);
    };
    request = https.get(
      url,
      {
        agent: false,
        ca: tls.rootCertificates,
        rejectUnauthorized: true,
        maxHeaderSize: 16384,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          'User-Agent': 'Glasses-Community/1',
        },
      },
      (response) => {
        response.on('error', fail);
        response.on('aborted', () => fail(new Error('Community response was interrupted')));
        if (response.statusCode !== 200) {
          fail(
            new Error(`Community service returned HTTP ${response.statusCode}; try again later`),
          );
          return;
        }
        if (
          response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity'
        ) {
          fail(new Error('Unexpected community response encoding'));
          return;
        }
        if (Number(response.headers['content-length']) > maximum) {
          fail(new Error('Community response exceeds its size limit'));
          return;
        }
        let size = 0;
        const parts = [];
        response.on('data', (part) => {
          size += part.length;
          if (size > maximum) fail(new Error('Community response exceeds its size limit'));
          else if (!failed) parts.push(part);
        });
        response.on('end', () => {
          clearTimeout(timer);
          if (!failed) resolve(Buffer.concat(parts));
        });
      },
    );
    timer = setTimeout(() => fail(new Error('Community request timed out')), 20000);
    request.on('error', (error) => {
      failed = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function fingerprint(plugin) {
  return plugin ? crypto.createHash('sha256').update(JSON.stringify(plugin)).digest('hex') : null;
}
class Community {
  constructor(plugins, options = {}) {
    this.plugins = plugins;
    this.fetch = options.fetch || fetchBytes;
    this.keys = options.keys || TRUSTED_KEYS;
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
    this.pending = new Map();
    this.active = 0;
  }
  async limited(fn) {
    if (this.active >= 3) throw new Error('Wait for the current community request');
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
    }
  }
  catalog(query) {
    return this.limited(async () => {
      const input = querySchema.parse(query);
      const params = new URLSearchParams({ q: input.q, page: String(input.page) });
      if (input.kind) params.set('kind', input.kind);
      return catalogSchema.parse(
        parseJson(await this.fetch(`${BASE}/catalog?${params}`, 2 * 1024 * 1024)),
      );
    });
  }
  preview(identity) {
    return this.limited(async () => {
      identity = identitySchema.parse(identity);
      const descriptor = verifyEnvelope(
        await this.fetch(packageUrl(identity, 'install'), 24000),
        identity,
        this.keys,
        this.now(),
      );
      const manifest = verifyPackage(
        await this.fetch(descriptor.downloadUrl, MAX_PACKAGE),
        descriptor,
      );
      const existing = this.plugins.items.find((x) => x.manifest.id === identity.id);
      if (existing && !existing.community)
        throw new Error(
          'A local plugin uses this identifier. Remove it explicitly before installing the community package.',
        );
      if (existing && compareVersions(manifest.version, existing.manifest.version) <= 0)
        throw new Error(
          'This version or a newer version is already installed. Downgrades are not permitted.',
        );
      for (const [key, value] of this.pending)
        if (value.descriptor.expiresAt <= this.now()) this.pending.delete(key);
      if (this.pending.size >= 10) this.pending.delete(this.pending.keys().next().value);
      const ticket = crypto.randomUUID();
      this.pending.set(ticket, { manifest, descriptor, previous: fingerprint(existing) });
      const { ui, ...summary } = manifest;
      return {
        ticket,
        manifest: summary,
        sha256: descriptor.sha256,
        keyId: descriptor.keyId,
        expiresAt: descriptor.expiresAt,
        previousVersion: existing?.manifest.version,
        addedCapabilities: manifest.capabilities.filter(
          (x) => !existing?.manifest.capabilities.includes(x),
        ),
      };
    });
  }
  discard(ticket) {
    this.pending.delete(z.string().uuid().parse(ticket));
  }
  install(input) {
    const { ticket, enable } = z
      .object({ ticket: z.string().uuid(), enable: z.boolean() })
      .strict()
      .parse(input);
    const prepared = this.pending.get(ticket);
    this.pending.delete(ticket);
    if (!prepared || prepared.descriptor.expiresAt <= this.now())
      throw new Error('Review expired. Fetch and review this package again.');
    const { manifest, descriptor, previous } = prepared;
    const index = this.plugins.items.findIndex((x) => x.manifest.id === manifest.id),
      existing = this.plugins.items[index];
    if (fingerprint(existing) !== previous)
      throw new Error('Installed plugin changed. Review the update again.');
    const old = this.plugins.items;
    const item = {
      manifest,
      enabled: enable,
      community: {
        keyId: descriptor.keyId,
        sha256: descriptor.sha256,
        installedAt: new Date(this.now() * 1000).toISOString(),
      },
    };
    this.plugins.items = index < 0 ? [...old, item] : old.map((p, i) => (i === index ? item : p));
    try {
      this.plugins.save();
    } catch (error) {
      this.plugins.items = old;
      throw error;
    }
    return this.plugins.items;
  }
}
module.exports = {
  Community,
  parseInstallUri,
  verifyEnvelope,
  verifyPackage,
  compareVersions,
  fetchBytes,
  packageUrl,
  identitySchema,
  TRUSTED_KEYS,
};
