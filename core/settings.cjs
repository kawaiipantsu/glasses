const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { bypassSchema, hopSchema } = require('./routing.cjs');
const schema = z
  .object({
    theme: z.enum(['system', 'dark', 'light']).default('system'),
    palette: z.enum(['red', 'violet', 'ocean', 'amber']).default('red'),
    density: z.enum(['comfortable', 'compact']).default('comfortable'),
    proxyPort: z.number().int().min(1024).max(65535).default(8080),
    socksPort: z.number().int().min(1024).max(65535).default(1080),
    socksEnabled: z.boolean().default(true),
    maxSessions: z.number().int().min(100).max(10000).default(1000),
    bodyLimitMB: z.number().int().min(1).max(16).default(2),
    timeoutSeconds: z.number().int().min(5).max(120).default(30),
    interceptTimeoutSeconds: z.number().int().min(10).max(300).default(120),
    interceptPhase: z.enum(['request', 'response', 'both']).default('request'),
    interceptFilter: z.string().max(500).default(''),
    bypassList: bypassSchema,
    relayEnabled: z.boolean().default(false),
    relayHops: z.array(hopSchema).max(8).default([]),
    scope: z.string().max(4000).default(''),
    exportPath: z.string().max(4096).default(''),
    autoStart: z.boolean().default(false),
    browserUrl: z
      .string()
      .url()
      .refine((v) => /^https?:\/\//.test(v), 'Use an HTTP(S) URL')
      .default('https://example.com'),
    communityEnabled: z.boolean().default(false),
  })
  .strict()
  .refine(
    (s) => !s.socksEnabled || s.proxyPort !== s.socksPort,
    'Proxy and SOCKS ports must differ',
  )
  .refine((s) => !s.relayEnabled || s.relayHops.length > 0, 'Add at least one relay hop')
  .refine(
    (s) => new Set(s.relayHops.map((h) => h.id)).size === s.relayHops.length,
    'Relay hop IDs must be unique',
  );
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
class Settings {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    this.value = schema.parse({});
    if (fs.existsSync(this.file)) {
      try {
        this.value = schema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      } catch {
        this.warning = 'Saved settings were invalid; defaults were loaded.';
      }
    }
  }
  update(value) {
    const next = schema.parse(value);
    atomicWrite(this.file, next);
    this.value = next;
    return next;
  }
}
module.exports = { Settings, schema, atomicWrite };
