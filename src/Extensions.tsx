import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  Download,
  FileJson,
  PackagePlus,
  Plus,
  Puzzle,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import type { Plugin, PluginManifest, Rule } from './types';
import { CommunityName, Empty, Modal, Pill, SectionHead, Toggle } from './components';
export function Rules({
  rules,
  setRules,
  seed,
  invoke,
  notify,
}: {
  rules: Rule[];
  setRules: (r: Rule[]) => void;
  seed?: Partial<Rule> & { nonce: number };
  invoke: <T = any>(a: string, v?: unknown) => Promise<T | undefined>;
  notify: (s: string) => void;
}) {
  const [draft, setDraft] = useState<Rule>();
  const fresh = (): Rule => ({
    id: crypto.randomUUID(),
    name: 'New header rule',
    enabled: true,
    phase: 'request',
    match: '',
    action: 'set-header',
    header: '',
    value: '',
  });
  useEffect(() => {
    if (seed) setDraft({ ...fresh(), ...seed });
  }, [seed?.nonce]);
  const save = async (list: Rule[]) => {
    const result = await invoke<Rule[]>('rules', list);
    if (result) {
      setRules(result);
      setDraft(undefined);
      notify('Rules saved');
    }
  };
  return (
    <div className="tool-page">
      <SectionHead
        eyebrow="MATCH · MODIFY · REPEAT"
        title="Rewrite rules"
        description="Apply explicit, repeatable changes to request and response headers."
      >
        <button className="primary" onClick={() => setDraft(fresh())}>
          <Plus size={16} />
          New rule
        </button>
      </SectionHead>
      {!rules.length ? (
        <Empty
          icon={<Boxes size={30} />}
          title="Make a change once. Apply it consistently."
          action={
            <button onClick={() => setDraft(fresh())}>
              <Plus size={15} />
              Create your first rule
            </button>
          }
        >
          Match a URL fragment, choose request or response, and set or remove a header. Applied
          rules are shown on each captured request.
        </Empty>
      ) : (
        <div className="rules-list">
          {rules.map((r) => (
            <article key={r.id}>
              <Toggle
                checked={r.enabled}
                onChange={(enabled) =>
                  save(rules.map((x) => (x.id === r.id ? { ...x, enabled } : x)))
                }
                label={`Enable ${r.name}`}
              />
              <div>
                <h3>{r.name}</h3>
                <p>
                  <Pill>{r.phase}</Pill>
                  <code>
                    {r.action === 'set-header' ? 'Set' : 'Remove'} {r.header}
                    {r.action === 'set-header' ? `: ${r.value}` : ''}
                  </code>
                </p>
                <small>URL contains: {r.match || 'all URLs'}</small>
              </div>
              <button onClick={() => setDraft({ ...r })}>Edit</button>
              <button
                className="icon-button"
                aria-label={`Delete ${r.name}`}
                onClick={() => save(rules.filter((x) => x.id !== r.id))}
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="inline-note">
        Rules use literal, case-sensitive URL matching. Transport-managed headers (Host,
        Content-Length, Transfer-Encoding, Connection and Upgrade) cannot be changed by rules.
      </div>
      {draft && (
        <Modal title="Header rewrite rule" close={() => setDraft(undefined)}>
          <div className="modal-content form-grid">
            <label>
              Name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <div className="form-row">
              <label>
                Phase
                <select
                  value={draft.phase}
                  onChange={(e) => setDraft({ ...draft, phase: e.target.value as Rule['phase'] })}
                >
                  <option value="request">Request</option>
                  <option value="response">Response</option>
                </select>
              </label>
              <label>
                Action
                <select
                  value={draft.action}
                  onChange={(e) => setDraft({ ...draft, action: e.target.value as Rule['action'] })}
                >
                  <option value="set-header">Set header</option>
                  <option value="remove-header">Remove header</option>
                </select>
              </label>
            </div>
            <label>
              URL contains
              <input
                placeholder="api.example.com/v1/"
                value={draft.match}
                onChange={(e) => setDraft({ ...draft, match: e.target.value })}
              />
            </label>
            <label>
              Header name
              <input
                placeholder="X-Research-ID"
                value={draft.header}
                onChange={(e) => setDraft({ ...draft, header: e.target.value })}
              />
            </label>
            {draft.action === 'set-header' && (
              <label>
                Value
                <input
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                />
              </label>
            )}
            <div className="modal-actions">
              <button onClick={() => setDraft(undefined)}>Cancel</button>
              <button
                className="primary"
                disabled={!draft.header || !draft.name}
                onClick={() => save([...rules.filter((r) => r.id !== draft.id), draft])}
              >
                Save rule
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function Plugins({
  plugins,
  setPlugins,
  invoke,
  notify,
}: {
  plugins: Plugin[];
  setPlugins: (p: Plugin[]) => void;
  invoke: <T = any>(a: string, v?: unknown) => Promise<T | undefined>;
  notify: (s: string) => void;
}) {
  const [preview, setPreview] = useState<PluginManifest>();
  const update = async (action: string, payload: unknown) => {
    const items = await invoke<Plugin[]>(action, payload);
    if (items) setPlugins(items);
  };
  return (
    <div className="tool-page">
      <SectionHead
        eyebrow="SMALL EXTENSIONS · BIG POSSIBILITIES"
        title="Plugins"
        description="Community-built rules and checks, installed locally and controlled by you."
      >
        <button onClick={() => invoke('pluginExample')}>
          <Download size={15} />
          Header example
        </button>
        <button onClick={() => invoke('pluginToolExample')}>
          <Download size={15} />
          Tool example
        </button>
        <button
          className="primary"
          onClick={async () => {
            const p = await invoke<PluginManifest>('pluginPreview');
            if (p) setPreview(p);
          }}
        >
          <PackagePlus size={16} />
          Install from file
        </button>
      </SectionHead>
      <div className="plugin-intro">
        <div className="plugin-icon">
          <Puzzle size={26} />
        </div>
        <div>
          <h2>A deliberate foundation for extensions</h2>
          <p>
            API v1 supports header rules, response checks, custom sidebar tools, and context-menu
            actions. Extension HTML and JavaScript run in isolated frames with capability-limited
            access to selected data.
          </p>
        </div>
        <Pill>API v1</Pill>
      </div>
      {!plugins.length ? (
        <Empty icon={<Puzzle size={32} />} title="Make Glasses your own">
          Install a .json plugin manifest, review its capabilities, then enable it. Download the
          example to try the complete workflow.
        </Empty>
      ) : (
        <div className="plugin-grid">
          {plugins.map((p) => (
            <article className="plugin-card" key={p.manifest.id}>
              <div className="plugin-card-top">
                <div className="plugin-icon">
                  <Puzzle size={24} />
                </div>
                <Toggle
                  checked={p.enabled}
                  label={`Enable ${p.manifest.name}`}
                  onChange={(enabled) => update('pluginToggle', { id: p.manifest.id, enabled })}
                />
              </div>
              <h2>{p.manifest.name}</h2>
              <div className="muted">
                <CommunityName name={p.manifest.author} /> · v{p.manifest.version}
              </div>
              <p>{p.manifest.description}</p>
              <div className="capabilities">
                {p.manifest.capabilities.map((c) => (
                  <Pill key={c}>{c}</Pill>
                ))}
              </div>
              <footer>
                <span>
                  {p.manifest.tools.length} tools · {p.manifest.contextMenus.length} actions ·{' '}
                  {p.manifest.rules.length} rules
                </span>
                <button
                  className="text-button"
                  onClick={() => update('pluginRemove', p.manifest.id)}
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
      {preview && (
        <Modal title="Review plugin capabilities" close={() => setPreview(undefined)}>
          <div className="modal-content">
            <h2>{preview.name}</h2>
            <p>{preview.description}</p>
            <div className="definition-list">
              <div>
                <span>Publisher (self-declared)</span>
                <span>
                  <CommunityName name={preview.author} />
                </span>
              </div>
              <div>
                <span>Version</span>
                <span>{preview.version}</span>
              </div>
              <div>
                <span>Identifier</span>
                <code>{preview.id}</code>
              </div>
            </div>
            <h3>Requested capabilities</h3>
            <div className="capabilities">
              {preview.capabilities.map((c) => (
                <Pill key={c} tone="amber">
                  {c}
                </Pill>
              ))}
            </div>
            <p className="muted">
              Installed disabled. Enabling this plugin permits its declared rules and checks to
              operate on matching captured traffic. Local packages are not publisher-verified.
            </p>
            <div className="modal-actions">
              <button onClick={() => setPreview(undefined)}>Cancel</button>
              <button
                className="primary"
                onClick={async () => {
                  const result = await invoke<Plugin[]>('pluginInstall', preview);
                  if (result) {
                    setPlugins(result);
                    setPreview(undefined);
                    notify('Plugin installed. Enable it when ready.');
                  }
                }}
              >
                Install plugin
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function Community({ openPlugins }: { openPlugins: () => void }) {
  return (
    <div className="tool-page">
      <SectionHead
        eyebrow="BUILT TOGETHER"
        title="Plugin Community"
        description="The future home for Glasses extensions."
      />
      <div className="community-hero">
        <div className="community-graphic">
          <Puzzle size={72} strokeWidth={1} />
          <span className="community-orbit">
            <Users size={22} />
          </span>
        </div>
        <Pill tone="amber">Coming in a later release</Pill>
        <h1>
          One workspace.
          <br />A community of possibilities.
        </h1>
        <p>
          The community catalog, publishing service, accounts, and update delivery are not connected
          yet. Local plugins work today.
        </p>
        <button className="primary" onClick={openPlugins}>
          <Puzzle size={16} />
          Manage local plugins
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
