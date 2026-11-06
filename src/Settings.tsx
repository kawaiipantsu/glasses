import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Folder,
  Info,
  LockKeyhole,
  Monitor,
  Moon,
  Network,
  Palette,
  Plug,
  Puzzle,
  Settings2,
  Shield,
  Sun,
  Users,
} from 'lucide-react';
import type { Bootstrap, SettingsValue } from './types';
import { Brand, CommunityName, Modal, Pill, SectionHead, Toggle } from './components';
import { ProxySettings } from './ProxySettings';
import { copy } from './utils';
const categories = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'proxy', label: 'Proxy & interception', icon: Network },
  { id: 'certificates', label: 'Certificates', icon: Shield },
  { id: 'storage', label: 'Files & storage', icon: Folder },
  { id: 'community', label: 'Plugins & community', icon: Puzzle },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'about', label: 'About Glasses', icon: Info },
];
function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
export default function Settings({
  data,
  saved,
  onSave,
  close,
  invoke,
  notify,
  openPlugins,
}: {
  data: Bootstrap;
  saved: SettingsValue;
  onSave: (s: SettingsValue) => void;
  close: () => void;
  invoke: <T = any>(a: string, v?: unknown) => Promise<T | undefined>;
  notify: (s: string) => void;
  openPlugins: () => void;
}) {
  const [category, setCategory] = useState('general'),
    [draft, setDraft] = useState({ ...saved }),
    [confirm, setConfirm] = useState(false),
    [saving, setSaving] = useState(false),
    [passphrase, setPassphrase] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof SettingsValue>(key: K, value: SettingsValue[K]) =>
    setDraft({ ...draft, [key]: value });
  const save = async () => {
    setSaving(true);
    const result = await invoke<{ settings: SettingsValue; restartRequired: boolean }>(
      'settings',
      draft,
    );
    if (result) {
      onSave(result.settings);
      setDraft(result.settings);
      notify(
        result.restartRequired
          ? 'Settings saved. Restart the proxy to apply listener changes.'
          : 'Settings saved',
      );
    }
    setSaving(false);
    return Boolean(result);
  };
  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <button className="back-button" onClick={() => (dirty ? setConfirm(true) : close())}>
          <ArrowLeft size={16} />
          Back to workspace
        </button>
        <h2>Settings</h2>
        <p>Your Glasses. Your workflow.</p>
        <nav>
          {categories.map((c) => (
            <button
              key={c.id}
              className={category === c.id ? 'active' : ''}
              onClick={() => setCategory(c.id)}
            >
              <c.icon size={18} />
              {c.label}
            </button>
          ))}
        </nav>
        <div className="settings-brand">
          <Brand compact />
        </div>
      </aside>
      <main className="settings-main">
        <SectionHead
          eyebrow="APPLICATION PREFERENCES"
          title={categories.find((c) => c.id === category)!.label}
          description="One place for every application setting."
        >
          {dirty && <Pill tone="amber">Unsaved changes</Pill>}
          <button className="primary" disabled={!dirty || saving} onClick={save}>
            <Check size={15} />
            Save changes
          </button>
        </SectionHead>
        <div className="settings-content">
          {category === 'general' && (
            <>
              <div className="settings-group">
                <h3>Startup & workspace</h3>
                <Row
                  title="Start proxy on launch"
                  description="Listen on your configured loopback ports when Glasses opens."
                >
                  <Toggle
                    checked={draft.autoStart}
                    onChange={(v) => set('autoStart', v)}
                    label="Start proxy on launch"
                  />
                </Row>
                <Row
                  title="Research browser home"
                  description="The URL opened by the isolated, proxy-connected browser."
                >
                  <input
                    aria-label="Research browser home"
                    value={draft.browserUrl}
                    onChange={(e) => set('browserUrl', e.target.value)}
                  />
                </Row>
              </div>
              <div className="settings-group">
                <h3>Target scope</h3>
                <p>
                  One literal host or URL fragment per line. Used by the In scope traffic filter.
                </p>
                <textarea
                  aria-label="Target scope"
                  className="settings-textarea mono"
                  placeholder="api.example.com&#10;localhost"
                  value={draft.scope}
                  onChange={(e) => set('scope', e.target.value)}
                />
              </div>
              <div className="settings-tip">
                <Info size={18} />
                <p>
                  Glasses binds to 127.0.0.1. Use Toggle proxy to route system HTTP/HTTPS and SOCKS
                  traffic on macOS. Glasses restores saved network settings when toggled off,
                  stopped, or quit. OS certificate trust is never changed by Glasses.
                </p>
              </div>
            </>
          )}
          {category === 'appearance' && (
            <>
              <div className="settings-group">
                <h3>Color mode</h3>
                <p>Match your environment. Keep the same familiar workspace.</p>
                <div className="theme-options">
                  {(
                    [
                      { id: 'system', name: 'System', icon: Monitor },
                      { id: 'dark', name: 'Dark', icon: Moon },
                      { id: 'light', name: 'Light', icon: Sun },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      className={`theme-option ${draft.theme === t.id ? 'chosen' : ''}`}
                      onClick={() => set('theme', t.id)}
                    >
                      <div className={`theme-preview ${t.id}`}>
                        <div />
                        <section>
                          <i />
                          <i />
                          <i />
                          <i />
                        </section>
                      </div>
                      <span>
                        <t.icon size={16} />
                        {t.name}
                        {draft.theme === t.id && <Check size={15} />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <h3>Accent palette</h3>
                <p>
                  Controls and highlights follow your palette. The <CommunityName /> name keeps its
                  two colors; the glasses stay red.
                </p>
                <div className="palette-options">
                  {(['red', 'violet', 'ocean', 'amber'] as const).map((p) => (
                    <button
                      key={p}
                      aria-label={`${p} accent`}
                      className={draft.palette === p ? 'chosen' : ''}
                      onClick={() => set('palette', p)}
                    >
                      <i className={`swatch ${p}`} />
                      <span>
                        {p === 'red' ? <CommunityName /> : p[0].toUpperCase() + p.slice(1)}
                      </span>
                      {draft.palette === p && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <Row
                  title="Interface density"
                  description="Compact mode fits more requests and headers on screen."
                >
                  <select
                    aria-label="Interface density"
                    value={draft.density}
                    onChange={(e) => set('density', e.target.value as SettingsValue['density'])}
                  >
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </select>
                </Row>
              </div>
            </>
          )}
          {category === 'proxy' && (
            <>
              {data.systemProxy.warning && (
                <div className="settings-tip">
                  <Info size={18} />
                  <p>{data.systemProxy.warning}</p>
                </div>
              )}
              <div className="settings-group">
                <h3>Local listeners</h3>
                <Row
                  title="HTTP / HTTPS proxy"
                  description="Loopback only. Changes apply on the next proxy start."
                >
                  <span className="muted mono">127.0.0.1:</span>
                  <input
                    aria-label="HTTP proxy port"
                    type="number"
                    min={1024}
                    max={65535}
                    value={draft.proxyPort}
                    onChange={(e) => set('proxyPort', Number(e.target.value))}
                  />
                </Row>
                <Row
                  title="SOCKS5 listener"
                  description="TCP CONNECT tunnels; UDP is not supported in this release."
                >
                  <Toggle
                    checked={draft.socksEnabled}
                    onChange={(v) => set('socksEnabled', v)}
                    label="Enable SOCKS5"
                  />
                  <input
                    aria-label="SOCKS5 port"
                    type="number"
                    min={1024}
                    max={65535}
                    value={draft.socksPort}
                    onChange={(e) => set('socksPort', Number(e.target.value))}
                  />
                </Row>
              </div>
              <div className="settings-group">
                <h3>Interception</h3>
                <Row
                  title="Pause at"
                  description="Choose which messages wait for you to forward or drop them."
                >
                  <select
                    aria-label="Intercept phase"
                    value={draft.interceptPhase}
                    onChange={(e) =>
                      set('interceptPhase', e.target.value as SettingsValue['interceptPhase'])
                    }
                  >
                    <option value="request">Request</option>
                    <option value="response">Response</option>
                    <option value="both">Request and response</option>
                  </select>
                </Row>
                <Row
                  title="URL contains"
                  description="Leave empty to intercept all traffic. Matching is literal and case-sensitive."
                >
                  <input
                    aria-label="Intercept URL filter"
                    value={draft.interceptFilter}
                    onChange={(e) => set('interceptFilter', e.target.value)}
                  />
                </Row>
                <Row
                  title="Interception deadline"
                  description="Unresolved messages are dropped after this many seconds."
                >
                  <input
                    aria-label="Intercept timeout"
                    type="number"
                    min={10}
                    max={300}
                    value={draft.interceptTimeoutSeconds}
                    onChange={(e) => set('interceptTimeoutSeconds', Number(e.target.value))}
                  />
                  <span>seconds</span>
                </Row>
                <Row title="Network request deadline">
                  <input
                    aria-label="Network timeout"
                    type="number"
                    min={5}
                    max={120}
                    value={draft.timeoutSeconds}
                    onChange={(e) => set('timeoutSeconds', Number(e.target.value))}
                  />
                  <span>seconds</span>
                </Row>
              </div>
              <ProxySettings
                draft={draft}
                set={set}
                invoke={invoke}
                notify={notify}
                dirty={dirty}
              />
            </>
          )}
          {category === 'certificates' && (
            <>
              <div className="settings-group">
                <div className="group-title">
                  <h3>Active signing certificate authority</h3>
                  <Pill tone="green">
                    {data.ca.source === 'custom' ? 'Organization CA' : 'Generated locally'}
                  </Pill>
                </div>
                <p>
                  Each installation has its own CA. The built-in research browser trusts this CA for
                  proxied traffic. Other clients require explicit trust configuration.
                </p>
                <div className="definition-list">
                  <div>
                    <span>Subject</span>
                    <span>{data.ca.subject}</span>
                  </div>
                  <div>
                    <span>Expires</span>
                    <span>{data.ca.validTo}</span>
                  </div>
                  <div>
                    <span>SHA-256</span>
                    <code>{data.ca.fingerprint}</code>
                  </div>
                  <div>
                    <span>Managed CA storage</span>
                    <code>{data.ca.path}</code>
                  </div>
                </div>
                <div className="button-row">
                  <button onClick={() => invoke('exportCA')}>
                    <Download size={15} />
                    Export CA certificate
                  </button>
                  <button
                    onClick={() =>
                      copy(data.ca.fingerprint).then(() => notify('Fingerprint copied'))
                    }
                  >
                    <Copy size={15} />
                    Copy fingerprint
                  </button>
                </div>
              </div>
              <div className="settings-group">
                <h3>Use your organization’s CA</h3>
                <p>
                  Import a PEM signing CA and its matching private key. An organization-issued
                  intermediate lets existing managed clients trust Glasses. Include parent
                  certificates after the signing CA in the PEM file.
                </p>
                <Row
                  title="Key passphrase"
                  description="Only needed for an encrypted PEM key. The passphrase is not saved."
                >
                  <input
                    aria-label="CA key passphrase"
                    type="password"
                    autoComplete="new-password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </Row>
                <div className="button-row">
                  <button
                    onClick={async () => {
                      const result = await invoke('importCA', passphrase);
                      setPassphrase('');
                      if (result) notify('Organization CA is now active');
                    }}
                  >
                    Import certificate & signing key…
                  </button>
                  {data.ca.source === 'custom' && (
                    <button
                      onClick={async () => {
                        if (await invoke('localCA')) notify('Local research CA restored');
                      }}
                    >
                      Use local CA
                    </button>
                  )}
                </div>
                <p>
                  Stop the proxy before switching CAs. This release supports RSA signing keys of at
                  least 2048 bits. Imported keys are stored in the private application data folder;
                  certificate exports never contain private keys. A public certificate alone cannot
                  sign intercepted connections.
                </p>
              </div>
              <div className="settings-group">
                <h3>Connect an external client</h3>
                <ol className="instructions">
                  <li>Export the public CA certificate and verify its fingerprint.</li>
                  <li>
                    Import it into your research browser’s certificate authorities, or pass it
                    explicitly to your HTTP client.
                  </li>
                  <li>
                    Set the HTTP/HTTPS proxy to <code>127.0.0.1:{draft.proxyPort}</code>.
                  </li>
                  <li>Remove the trust entry when you no longer need it.</li>
                </ol>
                <p>
                  macOS: Keychain Access. Windows: your test user’s certificate store. Linux: your
                  browser’s CA store or distribution trust tools. No OS trust installation is
                  performed by Glasses.
                </p>
              </div>
            </>
          )}
          {category === 'storage' && (
            <>
              <div className="settings-group">
                <h3>Local files</h3>
                <Row
                  title="Application data"
                  description="Settings, local CA, rules, and plugin manifests are stored in your platform’s user-data folder."
                >
                  <button onClick={() => invoke('openData')}>
                    <Folder size={15} />
                    Reveal folder
                  </button>
                </Row>
                <code className="path-display">{data.dataPath}</code>
                <Row
                  title="Default export directory"
                  description="Used as the starting folder for session, HAR, certificate, and body exports."
                >
                  <button
                    onClick={async () => {
                      const p = await invoke<string>('chooseExportPath');
                      if (p) set('exportPath', p);
                    }}
                  >
                    Choose folder…
                  </button>
                </Row>
                <code className="path-display">
                  {draft.exportPath || 'System Documents folder'}
                </code>
              </div>
              <div className="settings-group">
                <h3>Capture limits</h3>
                <Row
                  title="Maximum session entries"
                  description="Old completed entries are removed as this limit is reached."
                >
                  <input
                    aria-label="Maximum session entries"
                    type="number"
                    min={100}
                    max={10000}
                    value={draft.maxSessions}
                    onChange={(e) => set('maxSessions', Number(e.target.value))}
                  />
                </Row>
                <Row
                  title="Captured body limit"
                  description="Responses continue streaming after this limit. Requests larger than this limit are rejected."
                >
                  <input
                    aria-label="Body limit MB"
                    type="number"
                    min={1}
                    max={16}
                    value={draft.bodyLimitMB}
                    onChange={(e) => set('bodyLimitMB', Number(e.target.value))}
                  />
                  <span>MB / body</span>
                </Row>
              </div>
              <div className="settings-tip">
                <LockKeyhole size={18} />
                <p>
                  Traffic stays in memory until you explicitly save a session or HAR. Exports may
                  contain cookies and credentials. Stored settings and CA keys use private local
                  file permissions where supported.
                </p>
              </div>
            </>
          )}
          {category === 'community' && (
            <>
              <div className="settings-group">
                <h3>Local plugins</h3>
                <p>
                  Versioned manifests declare their capabilities. New plugins are installed
                  disabled; enabled extensions can modify matching headers and produce response
                  findings.
                </p>
                <button onClick={openPlugins}>
                  <Puzzle size={16} />
                  Manage installed plugins
                  <ChevronRight size={15} />
                </button>
              </div>
              <div className="settings-group">
                <div className="group-title">
                  <h3>Community services</h3>
                  <Pill>{draft.communityEnabled ? 'Enabled' : 'Offline'}</Pill>
                </div>
                <p>
                  Browse approved packages and review signed downloads in Community. Only catalog
                  queries and package identifiers are sent; captured traffic is never uploaded.
                  Publishing and accounts are handled on the website.
                </p>
                <Row title="Allow community connections">
                  <Toggle
                    checked={draft.communityEnabled}
                    onChange={(communityEnabled) => set('communityEnabled', communityEnabled)}
                    label="Allow community connections"
                  />
                </Row>
                <Row title="Community account">
                  <span className="muted">Not needed to browse or install</span>
                </Row>
                <Row title="Automatic plugin updates">
                  <Toggle
                    checked={false}
                    onChange={() => {}}
                    disabled
                    label="Automatic plugin updates unavailable"
                  />
                </Row>
              </div>
            </>
          )}
          {category === 'integrations' && (
            <>
              <div className="settings-group">
                <h3>Research browser</h3>
                <p>
                  Launch a separate browser session configured to use Glasses. It has no application
                  IPC access and does not reuse your personal browser profile.
                </p>
                <button onClick={() => invoke('browser')}>
                  <ExternalLink size={15} />
                  Open research browser
                </button>
              </div>
              <div className="settings-group">
                <h3>Command-line clients</h3>
                <p>After exporting your CA, substitute its path in the command below.</p>
                <pre className="integration-code">{`curl --proxy http://127.0.0.1:${draft.proxyPort} \\\n  --cacert /path/to/glasses-ca.pem \\\n  https://example.com`}</pre>
                <button
                  onClick={() =>
                    copy(
                      `curl --proxy http://127.0.0.1:${draft.proxyPort} --cacert /path/to/glasses-ca.pem https://example.com`,
                    ).then(() => notify('Command copied'))
                  }
                >
                  <Copy size={15} />
                  Copy cURL example
                </button>
                <h3>SOCKS-aware clients</h3>
                <pre className="integration-code">{`socks5h://127.0.0.1:${draft.socksPort}`}</pre>
                <p>SOCKS5 records tunnel metadata; HTTPS inside those tunnels is not decrypted.</p>
              </div>
              <div className="settings-group">
                <h3>Import & export</h3>
                <p>
                  Exchange captures with other tools using HAR, or save a Glasses session for later.
                </p>
                <div className="button-row">
                  <button onClick={() => invoke('importSession')}>Import session / HAR</button>
                  <button onClick={() => invoke('exportHAR')}>Export HAR</button>
                </div>
              </div>
            </>
          )}
          {category === 'about' && (
            <div className="about-pane">
              <Brand />
              <button onClick={() => invoke('openWebsite')}>
                <ExternalLink size={15} />
                glasses.thugs.red
              </button>
              <p>
                The official Glasses home and community address. Browse and review extensions in
                Community when the service is available.
              </p>
              <h1>Look closer.</h1>
              <p>
                A workspace for web security research,
                <br />
                debugging, and understanding what moves across the wire.
              </p>
              <Pill>
                Glasses {data.version} · {data.platform}
              </Pill>
              <div className="about-details">
                <p>Built for macOS, Windows, and Linux with Electron and Node.js.</p>
                <p>
                  <CommunityName /> · Danish hacking community
                </p>
                <p className="muted">
                  0.1 supports HTTP/1.1 inspection, HTTPS MITM, SOCKS5 TCP tunnels, and WebSocket
                  upgrade passthrough. HTTP/2, HTTP/3, and WebSocket frame editing are not yet
                  implemented.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
      {confirm && (
        <Modal title="Unsaved settings" close={() => setConfirm(false)}>
          <div className="modal-content">
            <p>Save your changes before returning to the workspace?</p>
            <div className="modal-actions">
              <button onClick={() => setConfirm(false)}>Keep editing</button>
              <button onClick={close}>Discard changes</button>
              <button
                className="primary"
                onClick={async () => {
                  if (await save()) close();
                }}
              >
                Save and return
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
