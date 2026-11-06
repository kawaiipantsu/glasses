import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Globe,
  Puzzle,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { CommunityCatalog, CommunityIntent, CommunityReview, Plugin } from './types';
import { Empty, Modal, Pill, SectionHead } from './components';
const descriptions: Record<string, string> = {
  'request.headers': 'Modify matching request headers before forwarding.',
  'response.headers': 'Modify matching response headers.',
  'response.analyze': 'Inspect response headers and contribute findings.',
  'ui.tools': 'Add a complete sidebar tool.',
  'ui.contextMenus': 'Add actions to supported context menus.',
  'traffic.readSelected':
    'Read the selected request and response, including sensitive headers and bodies.',
  'selection.read': 'Read text selected for an extension action.',
  'repeater.write': 'Prepare a Repeater draft; sending still requires your action.',
  'text.transform': 'Open text in the transformation workflow.',
};
export default function Community({
  plugins,
  setPlugins,
  enabled,
  protocolRegistered,
  intent,
  dismissIntent,
  connect,
  openPlugins,
  invoke,
  notify,
}: {
  plugins: Plugin[];
  setPlugins: (v: Plugin[]) => void;
  enabled: boolean;
  protocolRegistered: boolean;
  intent?: CommunityIntent;
  dismissIntent: () => void;
  connect: () => Promise<boolean>;
  openPlugins: () => void;
  invoke: <T = any>(a: string, v?: unknown) => Promise<T | undefined>;
  notify: (s: string) => void;
}) {
  const [q, setQ] = useState(''),
    [kind, setKind] = useState(''),
    [catalog, setCatalog] = useState<CommunityCatalog>(),
    [review, setReview] = useState<CommunityReview>(),
    [busy, setBusy] = useState(false),
    [attempted, setAttempted] = useState(false);
  const request = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  useEffect(() => {
    if (!enabled) {
      request.current++;
      setCatalog(undefined);
      setAttempted(false);
      setReview(undefined);
    }
  }, [enabled]);
  const browse = async (page = 1) => {
    if (busy) return;
    const generation = ++request.current;
    setBusy(true);
    try {
      if (!enabled && !(await connect())) return;
      setAttempted(true);
      const result = await invoke<CommunityCatalog>('communityCatalog', { q, kind, page });
      if (mounted.current && request.current === generation) setCatalog(result);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const prepare = async (identity: { id: string; version: string }) => {
    if (busy) return;
    const generation = ++request.current;
    setBusy(true);
    try {
      if (!enabled && !(await connect())) return;
      const result = await invoke<CommunityReview>('communityPreview', identity);
      if (mounted.current && request.current === generation) setReview(result);
      else if (result) void invoke('communityDiscard', result.ticket);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const cancel = () => {
    if (busy) return;
    if (review) void invoke('communityDiscard', review.ticket);
    setReview(undefined);
  };
  const install = async (enable: boolean) => {
    if (!review || busy) return;
    setBusy(true);
    try {
      const result = await invoke<Plugin[]>('communityInstall', { ticket: review.ticket, enable });
      if (result) {
        setPlugins(result);
        setReview(undefined);
        dismissIntent();
        notify(
          enable
            ? 'Community package installed and enabled.'
            : 'Community package installed, disabled.',
        );
      } else setReview(undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tool-page community-page">
      <SectionHead
        eyebrow="BUILT TOGETHER"
        title="Plugin Community"
        description="Discover tools from the Glasses community. Review permissions before making them part of your workspace."
      >
        <button onClick={openPlugins}>
          <Puzzle size={16} />
          Installed plugins
        </button>
        <button onClick={() => invoke('openWebsite')}>
          <Globe size={16} />
          Community website
        </button>
      </SectionHead>
      {intent && (
        <div className="community-intent" role="status">
          <Download size={20} />
          <div>
            <strong>Install request from your browser</strong>
            <p>
              <code>{intent.id}</code> · {intent.version}
            </p>
            <small>Nothing is installed or enabled until you review and confirm.</small>
          </div>
          <button
            className="primary"
            disabled={busy}
            onClick={() => prepare({ id: intent.id, version: intent.version })}
          >
            Review package
          </button>
          <button aria-label="Dismiss install request" disabled={busy} onClick={dismissIntent}>
            <X size={16} />
          </button>
        </div>
      )}
      {!enabled ? (
        <div className="community-hero">
          <Puzzle size={64} strokeWidth={1.2} />
          <Pill>Community connections are off</Pill>
          <h1>Find your next tool.</h1>
          <p>
            Connect to glasses.thugs.red to browse and install approved extensions. Searches and
            package identifiers are sent to the service. Captured traffic stays in your workspace.
          </p>
          <button className="primary" disabled={busy} onClick={() => browse()}>
            <Globe size={16} />
            Connect and browse
          </button>
          <small>You can turn this off in Settings → Plugins & community.</small>
        </div>
      ) : (
        <>
          <form
            className="community-search"
            onSubmit={(e) => {
              e.preventDefault();
              void browse();
            }}
          >
            <label className="grow">
              <Search size={16} />
              <input
                aria-label="Search community packages"
                placeholder="Search tools, checks, and extensions…"
                value={q}
                maxLength={200}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <select
              aria-label="Community package type"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">All packages</option>
              <option value="extension">Extensions</option>
              <option value="plugin">Plugins</option>
            </select>
            <button className="primary" disabled={busy} type="submit">
              {busy ? 'Working…' : 'Browse catalog'}
            </button>
          </form>
          {!catalog && (
            <Empty
              icon={<Globe size={30} />}
              title={
                attempted
                  ? 'The catalog is unavailable right now.'
                  : 'Browse the community catalog.'
              }
            >
              {attempted
                ? 'Try again when the service is available. Downloaded JSON packages can still be installed from Plugins.'
                : 'Choose Browse catalog to load approved packages. No account is required.'}
            </Empty>
          )}
          {catalog && !catalog.items.length && (
            <Empty title="No matching packages yet.">
              Try another search or check back as the community grows.
            </Empty>
          )}
          <div className="community-grid">
            {catalog?.items.map((item) => {
              const installed = plugins.find((p) => p.manifest.id === item.id);
              return (
                <article className="community-card" key={item.id}>
                  <div className="community-card-top">
                    <Puzzle size={25} />
                    <Pill>{item.kind}</Pill>
                  </div>
                  <h2>{item.name}</h2>
                  <p>{item.description}</p>
                  <small>
                    Published by {item.publisher.displayName} · v{item.version}
                  </small>
                  <code>{item.id}</code>
                  <div className="capabilities">
                    {item.capabilities.map((c) => (
                      <Pill key={c}>{c}</Pill>
                    ))}
                  </div>
                  <div className="community-card-footer">
                    <small>
                      {installed
                        ? `Installed ${installed.manifest.version}${installed.community ? '' : ' · local package'}`
                        : `${Math.ceil(item.size / 1024)} KiB`}
                    </small>
                    <button
                      disabled={busy || installed?.manifest.version === item.version}
                      onClick={() => prepare({ id: item.id, version: item.version })}
                    >
                      <Download size={15} />
                      {installed?.manifest.version === item.version
                        ? 'Installed'
                        : installed
                          ? 'Review update'
                          : 'Review install'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {catalog && catalog.pagination.totalPages > 1 && (
            <div className="community-pagination">
              <button
                disabled={busy || catalog.pagination.page <= 1}
                onClick={() => browse(catalog.pagination.page - 1)}
              >
                <ArrowLeft size={15} />
                Previous
              </button>
              <span>
                Page {catalog.pagination.page} of {catalog.pagination.totalPages}
              </span>
              <button
                disabled={busy || catalog.pagination.page >= catalog.pagination.totalPages}
                onClick={() => browse(catalog.pagination.page + 1)}
              >
                Next
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </>
      )}
      <div className="inline-note">
        <ShieldCheck size={16} />
        Downloads are verified against the pinned community signing key and exact package checksum.
        This authenticates community distribution; it is not a guarantee that an extension is safe.
      </div>
      {!protocolRegistered && (
        <div className="inline-note">
          Browser install links require an installed, packaged Glasses application registered for
          glasses:// links. In development, use this catalog or Plugins → Install from file.
        </div>
      )}
      {review && (
        <Modal
          title={review.previousVersion ? 'Review community update' : 'Review community install'}
          close={cancel}
        >
          <div className="modal-content community-review">
            <Pill tone="green">Community signature verified</Pill>
            <h2>{review.manifest.name}</h2>
            <p>{review.manifest.description}</p>
            <p>
              <code>{review.manifest.id}</code> ·{' '}
              {review.previousVersion ? `${review.previousVersion} → ` : ''}
              {review.manifest.version}
            </p>
            <p className="muted">
              Manifest author: {review.manifest.author}. Author names are supplied by the package.
            </p>
            <h3>Requested capabilities</h3>
            <div className="community-permissions">
              {review.manifest.capabilities.length ? (
                review.manifest.capabilities.map((c) => (
                  <div key={c}>
                    <strong>{c}</strong>
                    {review.previousVersion && review.addedCapabilities.includes(c) && (
                      <Pill tone="amber">New permission</Pill>
                    )}
                    <p>{descriptions[c]}</p>
                  </div>
                ))
              ) : (
                <p>No capabilities requested.</p>
              )}
            </div>
            <details>
              <summary>Verification details</summary>
              <p>Signing key: {review.keyId}</p>
              <p>SHA-256</p>
              <code className="community-hash">{review.sha256}</code>
              <p>Review expires at {new Date(review.expiresAt * 1000).toLocaleTimeString()}.</p>
            </details>
            <p className="muted">
              Installing disabled leaves the package inactive. Install & enable permits the
              capabilities above immediately. Updates replace the installed version; downgrades are
              refused.
            </p>
          </div>
          <div className="modal-actions community-review-actions">
            <button disabled={busy} onClick={cancel}>
              Cancel
            </button>
            <button disabled={busy} onClick={() => install(false)}>
              Install disabled
            </button>
            <button disabled={busy} className="primary" onClick={() => install(true)}>
              Install & enable
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
