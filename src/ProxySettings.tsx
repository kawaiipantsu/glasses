import { ArrowDown, ArrowUp, Network, Plus, Trash2 } from 'lucide-react';
import type { SettingsValue } from './types';
import { Toggle } from './components';
import { useState } from 'react';
export function ProxySettings({
  draft,
  set,
  invoke,
  notify,
  dirty,
}: {
  draft: SettingsValue;
  set: <K extends keyof SettingsValue>(key: K, value: SettingsValue[K]) => void;
  invoke: <T = any>(action: string, value?: unknown) => Promise<T | undefined>;
  notify: (s: string) => void;
  dirty: boolean;
}) {
  const [target, setTarget] = useState('https://example.com'),
    [detected, setDetected] = useState<any[]>();
  const update = (index: number, value: Partial<SettingsValue['relayHops'][number]>) =>
    set(
      'relayHops',
      draft.relayHops.map((h, i) => (i === index ? { ...h, ...value } : h)),
    );
  const move = (index: number, delta: number) => {
    const hops = [...draft.relayHops];
    [hops[index], hops[index + delta]] = [hops[index + delta], hops[index]];
    set('relayHops', hops);
  };
  return (
    <>
      <div className="settings-group">
        <h3>Privacy bypass list</h3>
        <p>
          Excluded destinations pass through without HTTPS decryption, interception, rules, plugin
          access, or traffic history. A configured upstream relay still carries them.
        </p>
        <textarea
          aria-label="Privacy bypass list"
          className="settings-textarea mono"
          placeholder={'internal.example.com\n*.corp.example.com\n10.0.0.0/8\n2001:db8::/32'}
          value={draft.bypassList}
          onChange={(e) => set('bypassList', e.target.value)}
        />
        <p>
          One hostname, wildcard subdomain, IP, or IPv4/IPv6 CIDR per line. A wildcard excludes
          subdomains; add the bare domain separately. CIDRs also check local DNS results. Saving
          closes existing tunnels; earlier captures remain until cleared. Repeater and TLS Inspector
          refuse excluded destinations.
        </p>
      </div>
      <div className="settings-group">
        <div className="group-title">
          <h3>Proxy / SOCKS relaying</h3>
          <Toggle
            checked={draft.relayEnabled}
            onChange={(v) => set('relayEnabled', v)}
            label="Enable upstream relay"
          />
        </div>
        <p>
          Chain up to eight HTTP CONNECT, HTTPS CONNECT, or SOCKS5 proxies. Each hop reaches the
          next; the last reaches your destination. Relay failures never fall back to a direct
          connection.
        </p>
        <div className="route-preview">
          <Network size={16} />
          <span>Browser</span>
          <b>→</b>
          <span>Glasses</span>
          {draft.relayHops.map((h, i) => (
            <span key={h.id}>
              <b> → </b>
              {h.host || `Hop ${i + 1}`}
            </span>
          ))}
          <b>→</b>
          <span>Destination</span>
        </div>
        {draft.relayHops.map((hop, index) => (
          <div className="relay-hop" key={hop.id}>
            <div className="group-title">
              <strong>Hop {index + 1}</strong>
              <div className="button-row">
                <button
                  aria-label={`Move hop ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  aria-label={`Move hop ${index + 1} down`}
                  disabled={index === draft.relayHops.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  aria-label={`Remove hop ${index + 1}`}
                  onClick={() =>
                    set(
                      'relayHops',
                      draft.relayHops.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="relay-fields">
              <label>
                Protocol
                <select
                  aria-label={`Hop ${index + 1} protocol`}
                  value={hop.type}
                  onChange={(e) => update(index, { type: e.target.value as typeof hop.type })}
                >
                  <option value="http">HTTP proxy</option>
                  <option value="https">HTTPS proxy</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </label>
              <label>
                Host
                <input
                  aria-label={`Hop ${index + 1} host`}
                  placeholder="proxy.corp.example"
                  value={hop.host}
                  onChange={(e) => update(index, { host: e.target.value })}
                />
              </label>
              <label>
                Port
                <input
                  aria-label={`Hop ${index + 1} port`}
                  type="number"
                  min={1}
                  max={65535}
                  value={hop.port}
                  onChange={(e) => update(index, { port: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="relay-auth">
              <label>
                Username
                <input
                  aria-label={`Hop ${index + 1} username`}
                  autoComplete="off"
                  value={hop.username}
                  onChange={(e) => update(index, { username: e.target.value })}
                />
              </label>
              <label>
                Password
                <input
                  aria-label={`Hop ${index + 1} password`}
                  type="password"
                  autoComplete="new-password"
                  placeholder={hop.hasPassword ? 'Saved securely; leave blank to keep' : 'Optional'}
                  value={hop.password ?? ''}
                  onChange={(e) => update(index, { password: e.target.value })}
                />
              </label>
              {hop.hasPassword && (
                <button onClick={() => update(index, { password: '', hasPassword: false })}>
                  Clear password
                </button>
              )}
            </div>
          </div>
        ))}
        <div className="button-row">
          <button
            disabled={draft.relayHops.length >= 8}
            onClick={() =>
              set('relayHops', [
                ...draft.relayHops,
                {
                  id: crypto.randomUUID(),
                  type: 'http',
                  host: '',
                  port: 8080,
                  username: '',
                  hasPassword: false,
                },
              ])
            }
          >
            <Plus size={15} />
            Add proxy hop
          </button>
          <button onClick={async () => setDetected(await invoke<any[]>('detectedProxies'))}>
            Show current macOS proxies
          </button>
        </div>
        {detected && (
          <div className="detected-proxies">
            {detected.length ? (
              detected.map((s, i) => (
                <p key={i}>
                  <strong>{s.name}</strong>:{' '}
                  {['http', 'https', 'socks']
                    .filter((k) => s[k])
                    .map((k) => `${k.toUpperCase()} ${s[k].host}:${s[k].port}`)
                    .join(' · ') || 'No manual proxy'}
                  {s.pac ? ' · PAC / auto discovery enabled' : ''}
                </p>
              ))
            ) : (
              <p>No macOS network proxies available.</p>
            )}
          </div>
        )}
        <p>
          HTTP Basic and SOCKS5 username/password are supported. Passwords use OS-backed encryption.
          PAC scripts, NTLM, Kerberos and SOCKS4 are not supported yet. With HTTP/SOCKS5, the first
          link is unencrypted; use HTTPS proxy transport where available.
        </p>
        <div className="relay-test">
          <input
            aria-label="Relay test destination"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <button
            disabled={dirty}
            onClick={async () => {
              const result = await invoke<{ milliseconds: number; hops: number }>(
                'testRelay',
                target,
              );
              if (result)
                notify(
                  `Connection succeeded through ${result.hops} relay hop(s) in ${result.milliseconds} ms`,
                );
            }}
          >
            Test saved route
          </button>
        </div>
        <p>
          Save first. This opens a connection to the destination; an HTTPS test also verifies its
          TLS certificate. No page is fetched.
        </p>
      </div>
    </>
  );
}
