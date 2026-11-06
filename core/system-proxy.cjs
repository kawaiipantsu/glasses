const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { atomicWrite } = require('./settings.cjs');
const state = (service) => ({ enabled: service.enabled, config: service.config });
function managed(service, ports) {
  return {
    enabled: true,
    config: {
      ...service.config,
      HTTPEnable: 1,
      HTTPProxy: '127.0.0.1',
      HTTPPort: ports.proxyPort,
      HTTPSEnable: 1,
      HTTPSProxy: '127.0.0.1',
      HTTPSPort: ports.proxyPort,
      SOCKSEnable: ports.socksEnabled ? 1 : 0,
      SOCKSProxy: '127.0.0.1',
      SOCKSPort: ports.socksPort,
      HTTPUser: '',
      HTTPSUser: '',
      SOCKSUser: '',
      HTTPPassword: '',
      HTTPSPassword: '',
      SOCKSPassword: '',
      HTTPAuthEnable: 0,
      HTTPSAuthEnable: 0,
      SOCKSAuthEnable: 0,
      ProxyAutoConfigEnable: 0,
      ProxyAutoDiscoveryEnable: 0,
    },
  };
}
function restorePlan(saved, current) {
  const actual = state(current);
  if (isDeepStrictEqual(actual, saved.original)) return { desired: actual, external: false };
  if (isDeepStrictEqual(actual, saved.managed)) return { desired: saved.original, external: false };
  const config = { ...actual.config },
    original = saved.original.config || {},
    applied = saved.managed.config || {};
  let externalRouting = false;
  const restoreKey = (key) => {
    const same =
      isDeepStrictEqual(config[key], applied[key]) ||
      (config[key] === undefined && (applied[key] === '' || applied[key] === 0));
    if (same) {
      if (Object.hasOwn(original, key)) config[key] = original[key];
      else delete config[key];
    }
  };
  for (const protocol of ['HTTP', 'HTTPS', 'SOCKS']) {
    const own =
      config[protocol + 'Proxy'] === applied[protocol + 'Proxy'] &&
      config[protocol + 'Port'] === applied[protocol + 'Port'];
    if (own)
      for (const suffix of ['Enable', 'Proxy', 'Port', 'User', 'Password', 'AuthEnable'])
        restoreKey(protocol + suffix);
    else externalRouting = true;
  }
  if (
    !externalRouting &&
    isDeepStrictEqual(config.ProxyAutoConfigURLString, applied.ProxyAutoConfigURLString)
  ) {
    restoreKey('ProxyAutoConfigEnable');
    restoreKey('ProxyAutoDiscoveryEnable');
  }
  return {
    desired: {
      enabled:
        !externalRouting && actual.enabled === saved.managed.enabled
          ? saved.original.enabled
          : actual.enabled,
      config,
    },
    external: true,
  };
}
function nativeAdapter(helper) {
  return (input) =>
    new Promise((resolve, reject) => {
      const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '',
        size = 0;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('macOS proxy settings operation timed out'));
      }, 120000);
      child.stdout.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2e6) child.kill();
        else output += chunk;
      });
      child.stderr.resume();
      child.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        try {
          const value = JSON.parse(output);
          if (code || value.error) reject(new Error(value.error || 'Proxy helper failed'));
          else resolve(value);
        } catch {
          reject(new Error('Proxy helper returned invalid output'));
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(input));
    });
}
class SystemProxy {
  constructor(dir, options = {}) {
    this.supported = (options.platform || process.platform) === 'darwin';
    this.adapter = options.adapter || nativeAdapter(options.helper);
    this.file = path.join(dir, 'system-proxy-recovery.json');
    this.snapshot = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : null;
    this.busy = false;
    this.warning = '';
  }
  status() {
    return {
      supported: this.supported,
      active: Boolean(this.snapshot),
      busy: this.busy,
      warning: this.warning,
      services: this.snapshot?.map((s) => s.name) || [],
    };
  }
  async enable(ports) {
    if (!this.supported)
      throw new Error('Automatic system proxy routing is currently available on macOS');
    if (this.busy) throw new Error('A proxy settings operation is already in progress');
    if (this.snapshot) return this.status();
    this.busy = true;
    try {
      const read = await this.adapter({ command: 'read' });
      const services = read.services.filter(
        (s) => s.active !== false && s.serviceEnabled !== false,
      );
      if (!services.length) throw new Error('No enabled network services found');
      this.snapshot = services.map((s) => ({
        id: s.id,
        name: s.name,
        original: state(s),
        managed: managed(s, ports),
      }));
      atomicWrite(this.file, this.snapshot);
      await this.adapter({
        command: 'write',
        changes: this.snapshot.map((s) => ({ id: s.id, expected: s.original, desired: s.managed })),
      });
      this.warning = '';
    } catch (e) {
      // Commit may have succeeded even when apply/transport failed. Keep the recovery journal until verified.
      if (this.snapshot)
        try {
          await this.restoreInternal();
        } catch {
          this.warning = 'Proxy changes need recovery. Use Toggle proxy to retry restoration.';
        }
      throw e;
    } finally {
      this.busy = false;
    }
    return this.status();
  }
  async restoreInternal() {
    if (!this.snapshot) return;
    const { services } = await this.adapter({ command: 'read' });
    const changes = [],
      external = [];
    for (const saved of this.snapshot) {
      const current = services.find((s) => s.id === saved.id);
      if (!current) {
        external.push(saved.name);
        continue;
      }
      const plan = restorePlan(saved, current);
      if (plan.external) external.push(saved.name);
      if (!isDeepStrictEqual(state(current), plan.desired))
        changes.push({ id: saved.id, expected: state(current), desired: plan.desired });
    }
    if (changes.length) await this.adapter({ command: 'write', changes });
    if (external.length)
      atomicWrite(path.join(path.dirname(this.file), 'system-proxy-last-recovery.json'), {
        saved: this.snapshot,
        preservedServices: external,
        recoveredAt: new Date().toISOString(),
      });
    fs.rmSync(this.file, { force: true });
    this.snapshot = null;
    this.warning = external.length
      ? 'Glasses proxy settings were released. Settings changed outside Glasses were preserved.'
      : '';
  }

  async restore() {
    if (this.busy) throw new Error('A proxy settings operation is already in progress');
    this.busy = true;
    try {
      await this.restoreInternal();
    } catch (e) {
      this.warning = e.message;
      throw e;
    } finally {
      this.busy = false;
    }
    return this.status();
  }
  async detected() {
    if (!this.supported) return [];
    const { services } = await this.adapter({ command: 'read' });
    return services
      .filter((s) => s.active !== false && s.serviceEnabled !== false)
      .map((s) => ({
        name: s.name,
        http: s.config?.HTTPEnable ? { host: s.config.HTTPProxy, port: s.config.HTTPPort } : null,
        https: s.config?.HTTPSEnable
          ? { host: s.config.HTTPSProxy, port: s.config.HTTPSPort }
          : null,
        socks: s.config?.SOCKSEnable
          ? { host: s.config.SOCKSProxy, port: s.config.SOCKSPort }
          : null,
        pac: Boolean(s.config?.ProxyAutoConfigEnable || s.config?.ProxyAutoDiscoveryEnable),
      }));
  }
}
module.exports = { SystemProxy, managed, restorePlan };
