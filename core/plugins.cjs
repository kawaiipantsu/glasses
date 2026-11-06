const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { atomicWrite } = require('./settings.cjs');
const headerName = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  .max(128);
const safeValue = z
  .string()
  .max(8192)
  .refine((v) => !/[\r\n\0]/.test(v), 'Invalid header value');
const ruleSchema = z
  .object({
    id: z.string().max(100),
    name: z.string().max(100),
    enabled: z.boolean(),
    phase: z.enum(['request', 'response']),
    match: z.string().max(500),
    action: z.enum(['set-header', 'remove-header']),
    header: headerName,
    value: safeValue.default(''),
  })
  .strict();
const pluginSchema = z
  .object({
    apiVersion: z.literal(1),
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
      .max(100),
    name: z.string().min(1).max(100),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    author: z.string().max(100),
    description: z.string().max(1000),
    capabilities: z
      .array(
        z.enum([
          'request.headers',
          'response.headers',
          'response.analyze',
          'ui.tools',
          'ui.contextMenus',
          'traffic.readSelected',
          'selection.read',
          'repeater.write',
          'text.transform',
        ]),
      )
      .max(9),
    rules: z.array(ruleSchema).max(100).default([]),
    checks: z
      .array(
        z
          .object({
            header: headerName,
            when: z.enum(['missing', 'present', 'contains']),
            value: z.string().max(500).default(''),
            title: z.string().max(150),
            advice: z.string().max(1000),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    tools: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(50),
            label: z.string().min(1).max(40),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    contextMenus: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(50),
            label: z.string().min(1).max(60),
            contexts: z
              .array(
                z.enum([
                  'traffic',
                  'request.headers',
                  'request.body',
                  'response.headers',
                  'response.body',
                  'repeater',
                  'intercept',
                  'timeline',
                  'tls',
                ]),
              )
              .min(1)
              .max(9),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    ui: z
      .object({
        html: z.string().max(100000),
        css: z.string().max(50000).default(''),
        javascript: z.string().max(100000).default(''),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const r of v.rules)
      if (!v.capabilities.includes(r.phase + '.headers'))
        ctx.addIssue({ code: 'custom', message: `Missing ${r.phase}.headers capability` });
    if (v.checks.length && !v.capabilities.includes('response.analyze'))
      ctx.addIssue({ code: 'custom', message: 'Missing response.analyze capability' });
    if (v.tools.length && !v.capabilities.includes('ui.tools'))
      ctx.addIssue({ code: 'custom', message: 'Missing ui.tools capability' });
    if (v.contextMenus.length && !v.capabilities.includes('ui.contextMenus'))
      ctx.addIssue({ code: 'custom', message: 'Missing ui.contextMenus capability' });
    if ((v.tools.length || v.contextMenus.length) && !v.ui)
      ctx.addIssue({ code: 'custom', message: 'UI contributions require a ui document' });
    const ids = [...v.tools, ...v.contextMenus].map((x) => x.id);
    if (ids.length !== new Set(ids).size)
      ctx.addIssue({ code: 'custom', message: 'Contribution IDs must be unique' });
  });
function applyRules(rules, phase, record, headers) {
  const applied = [];
  for (const rule of rules)
    if (rule.enabled && rule.phase === phase && (!rule.match || record.url.includes(rule.match))) {
      const key = rule.header.toLowerCase();
      if (
        [
          'host',
          'connection',
          'content-length',
          'transfer-encoding',
          'proxy-authorization',
          'upgrade',
        ].includes(key)
      )
        continue;
      if (rule.action === 'remove-header') delete headers[key];
      else headers[key] = rule.value;
      applied.push(rule.name);
    }
  return applied;
}
class Plugins {
  constructor(dir) {
    this.file = path.join(dir, 'plugins.json');
    this.items = [];
    if (fs.existsSync(this.file)) {
      try {
        this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')).map((p) => ({
          manifest: pluginSchema.parse(p.manifest),
          enabled: p.enabled === true,
          ...(p.community
            ? {
                community: z
                  .object({
                    keyId: z.string().max(80),
                    sha256: z.string().regex(/^[a-f0-9]{64}$/),
                    installedAt: z.string().datetime(),
                  })
                  .strict()
                  .parse(p.community),
              }
            : {}),
        }));
      } catch {
        this.items = [];
      }
    }
  }
  save() {
    atomicWrite(this.file, this.items);
  }
  preview(json) {
    if (Buffer.byteLength(json) > 256 * 1024) throw new Error('Plugin exceeds 256 KB');
    return pluginSchema.parse(JSON.parse(json));
  }
  install(manifest) {
    if (Buffer.byteLength(JSON.stringify(manifest)) > 256 * 1024)
      throw new Error('Plugin exceeds 256 KB');
    manifest = pluginSchema.parse(manifest);
    if (this.items.some((p) => p.manifest.id === manifest.id))
      throw new Error('Plugin already installed. Remove it before installing a replacement.');
    this.items.push({ manifest, enabled: false });
    this.save();
    return this.items;
  }
  toggle(id, enabled) {
    const p = this.items.find((p) => p.manifest.id === id);
    if (!p) throw new Error('Plugin not found');
    p.enabled = Boolean(enabled);
    this.save();
    return this.items;
  }
  remove(id) {
    this.items = this.items.filter((p) => p.manifest.id !== id);
    this.save();
    return this.items;
  }
  rules() {
    return this.items
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.manifest.rules.map((r) => ({ ...r, name: `${p.manifest.name}: ${r.name}` })),
      );
  }
  analyze(record) {
    return this.items
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.manifest.checks
          .filter((c) => {
            const value = record.responseHeaders?.[c.header.toLowerCase()];
            return c.when === 'missing'
              ? value === undefined
              : c.when === 'present'
                ? value !== undefined
                : String(value || '').includes(c.value);
          })
          .map((c) => ({
            header: c.header,
            level: 'review',
            title: c.title,
            evidence: String(record.responseHeaders?.[c.header.toLowerCase()] || 'Header absent'),
            advice: c.advice,
            plugin: p.manifest.name,
          })),
      );
  }
}
module.exports = { Plugins, ruleSchema, pluginSchema, applyRules };
