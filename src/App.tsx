import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Boxes,
  ChevronDown,
  Circle,
  Command,
  Crosshair,
  ExternalLink,
  FlaskConical,
  Globe,
  LockKeyhole,
  Play,
  Puzzle,
  Radio,
  Search,
  Settings as SettingsIcon,
  Shield,
  Square,
  Users,
  X,
} from 'lucide-react';
import type {
  Bootstrap,
  Job,
  MenuAction,
  Plugin,
  RequestDraft,
  Rule,
  SettingsValue,
  Status,
  TrafficRecord,
  View,
} from './types';
import { api, asCurl, copy, encode, host } from './utils';
import {
  Brand,
  ContextMenu,
  Empty,
  IconButton,
  Modal,
  Pill,
  SearchBox,
  Toggle,
  TransformModal,
} from './components';
import Traffic, { type RecordAction, type ShowMenu } from './Traffic';
import Repeater, { Intercept, type RepeaterSeed } from './Repeater';
import { HeaderInspector, Timeline, TLSInspector } from './Inspectors';
import { Plugins, Rules } from './Extensions';
import Community from './Community';
import type { CommunityIntent } from './types';
import Settings from './Settings';
import PluginView, { type ExtensionContext } from './PluginView';
const navigation = [
  { id: 'traffic', label: 'Traffic', icon: ArrowLeftRight },
  { id: 'intercept', label: 'Intercept', icon: Crosshair },
  { id: 'repeater', label: 'Repeater', icon: Play },
  { id: 'timeline', label: 'Timeline', icon: Activity },
  { id: 'tls', label: 'TLS Inspector', icon: LockKeyhole },
  { id: 'headers', label: 'Header Hardening', icon: Shield },
  { id: 'rules', label: 'Rules', icon: Boxes },
] as const;
export default function App() {
  const [data, setData] = useState<Bootstrap>(),
    [error, setError] = useState(''),
    [records, setRecords] = useState<TrafficRecord[]>([]),
    [status, setStatus] = useState<Status>(),
    [settings, setSettings] = useState<SettingsValue>(),
    [plugins, setPlugins] = useState<Plugin[]>([]),
    [installIntent, setInstallIntent] = useState<CommunityIntent>(),
    [rules, setRules] = useState<Rule[]>([]),
    [systemDark, setSystemDark] = useState(true),
    [view, setView] = useState<View>('traffic'),
    [previousView, setPreviousView] = useState<View>('traffic'),
    [selectedId, setSelectedId] = useState<string>(),
    [filterHost, setFilterHost] = useState(''),
    [toast, setToast] = useState(''),
    [busy, setBusy] = useState(0),
    [seed, setSeed] = useState<RepeaterSeed>(),
    [job, setJobRaw] = useState<Job>(),
    [ruleSeed, setRuleSeed] = useState<Partial<Rule> & { nonce: number }>(),
    [tlsUrl, setTlsUrl] = useState(''),
    [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      title: string;
      items: MenuAction[];
    }>(),
    [transformation, setTransformation] = useState<{
      text: string;
      replace?: (s: string) => void;
    }>(),
    [paletteOpen, setPaletteOpen] = useState(false),
    [commandSearch, setCommandSearch] = useState(''),
    [extension, setExtension] = useState<{ pluginId: string; context: ExtensionContext }>();
  const selectedRef = useRef<TrafficRecord | undefined>(undefined);
  const selected = records.find((r) => r.id === selectedId) || records.at(-1);
  selectedRef.current = selected;
  const notify = useCallback(
    (message: string) =>
      setToast(message.replace(/^Error invoking remote method 'glasses:invoke': Error: /, '')),
    [],
  );
  const invoke = useCallback(
    async <T = any,>(action: string, payload?: unknown): Promise<T | undefined> => {
      setBusy((n) => n + 1);
      try {
        const result = await api.invoke<T>(action, payload);
        if (['start', 'stop', 'intercept'].includes(action)) setStatus(result as Status);
        if (
          [
            'exportSession',
            'exportHAR',
            'exportCA',
            'saveBody',
            'pluginExample',
            'pluginToolExample',
          ].includes(action) &&
          result
        )
          notify('File saved');
        if (action === 'importSession' && result) notify(`Imported ${result} requests`);
        return result;
      } catch (e) {
        notify((e as Error).message);
        return undefined;
      } finally {
        setBusy((n) => n - 1);
      }
    },
    [notify],
  );
  const setJob = (next: Job) =>
    setJobRaw((current) =>
      current?.id === next.id && current.completed > next.completed ? current : next,
    );
  useEffect(() => {
    const unsubscribe = api.subscribe(({ type, data }) => {
      if (type === 'record')
        setRecords((items) => {
          const index = items.findIndex((r) => r.id === data.id);
          if (index < 0) return [...items, data];
          const next = [...items];
          next[index] = data;
          return next;
        });
      else if (type === 'removed') setRecords((items) => items.filter((r) => r.id !== data));
      else if (type === 'clear') setRecords([]);
      else if (type === 'systemProxy')
        setData((current) => (current ? { ...current, systemProxy: data } : current));
      else if (type === 'ca') setData((current) => (current ? { ...current, ca: data } : current));
      else if (type === 'status') setStatus(data);
      else if (type === 'job') setJobRaw(data);
      else if (type === 'appearance') setSystemDark(data);
      else if (type === 'plugins') setPlugins(data);
      else if (type === 'communityIntent') {
        setInstallIntent(data);
        setView('community');
      } else if (type === 'navigate') setView(data);
      else if (type === 'error') notify(data);
    });
    api
      .invoke<Bootstrap>('bootstrap')
      .then((value) => {
        setData(value);
        setRecords(value.records);
        setSettings(value.settings);
        setPlugins(value.plugins);
        setRules(value.rules);
        setStatus(value.status);
        setSystemDark(value.dark);
        if (value.warning) notify(value.warning);
        if (value.installIntent) {
          setInstallIntent(value.installIntent);
          setView('community');
        }
      })
      .catch((e) => setError(e.message));
    return unsubscribe;
  }, [notify]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  const openSettings = () => {
    if (view !== 'settings') {
      setPreviousView(view);
      setView('settings');
    }
  };
  const transform = (text: string, replace?: (s: string) => void) =>
    setTransformation({ text, replace });
  const select = (id: string) => {
    setSelectedId(id);
    selectedRef.current = records.find((r) => r.id === id);
  };
  const action: RecordAction = (kind, r, extra) => {
    if (r?.id) select(r.id);
    if (kind === 'repeater' || kind === 'fuzz-selection') {
      setSeed({
        record: r,
        nonce: Date.now(),
        fuzz: kind === 'fuzz-selection' ? String(extra) : undefined,
      });
      setView('repeater');
    } else if (kind === 'copy-curl') {
      void copy(asCurl(r))
        .then(() => notify('Copied cURL command'))
        .catch((e) => notify(e.message));
    } else if (kind === 'copy-url') {
      void copy(r.url).then(() => notify('URL copied'));
    } else if (kind === 'copy-draft') {
      const d = extra as RequestDraft;
      void copy(
        asCurl({
          ...r,
          url: d.url,
          method: d.method,
          requestHeaders: d.headers,
          requestBody: d.bodyEncoding === 'base64' ? d.body : encode(d.body),
        }),
      ).then(() => notify('Copied cURL command'));
    } else if (kind === 'intercept-next') {
      void (async () => {
        if (!settings) return;
        const u = new URL(r.url);
        const next = {
          ...settings,
          interceptFilter: u.origin + u.pathname,
          interceptPhase: 'request' as const,
        };
        const result = await invoke<{ settings: SettingsValue }>('settings', next);
        if (result) {
          setSettings(result.settings);
          await invoke('intercept', true);
          setView('intercept');
          notify('Interception enabled for matching requests');
        }
      })();
    } else if (kind === 'rule') {
      setRuleSeed({ ...(extra as Partial<Rule>), match: host(r.url), nonce: Date.now() });
      setView('rules');
    } else if (kind === 'tls') {
      setTlsUrl(r.url);
      setView('tls');
    } else setView(kind as View);
  };
  const sendDraft = (draft: RequestDraft) => {
    const r: TrafficRecord = {
      id: 'extension-draft',
      number: 0,
      url: draft.url,
      method: draft.method,
      requestHeaders: draft.headers,
      requestBody: draft.bodyEncoding === 'base64' ? draft.body : encode(draft.body),
      requestBytes: 0,
      responseHeaders: {},
      responseBody: '',
      responseBytes: 0,
      duration: 0,
      startedAt: new Date().toISOString(),
      state: 'draft',
      status: 0,
      timings: {},
      protocol: 'HTTP',
      source: 'extension',
      appliedRules: [],
    };
    setSeed({ record: r, nonce: Date.now(), draft });
    setView('repeater');
    notify('Extension request prepared in Repeater');
  };
  const menu: ShowMenu = (event, title, items) => {
    event.preventDefault();
    const name = title.toLowerCase();
    const context = name.includes('editable')
      ? 'repeater'
      : name.includes('intercepted')
        ? 'intercept'
        : name.includes('timeline') || name.includes('iteration')
          ? 'timeline'
          : name.includes('certificate')
            ? 'tls'
            : name.includes('request header')
              ? 'request.headers'
              : name.includes('response header')
                ? 'response.headers'
                : name.startsWith('request text') || name.startsWith('request bytes')
                  ? 'request.body'
                  : name.startsWith('response text') || name.startsWith('response bytes')
                    ? 'response.body'
                    : 'traffic';
    const selection = window.getSelection()?.toString() || '';
    const active = document.activeElement;
    const textareaSelection =
      active instanceof HTMLTextAreaElement
        ? active.value.slice(active.selectionStart, active.selectionEnd)
        : '';
    const record = selectedRef.current;
    const extensions = plugins
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.manifest.contextMenus
          .filter((c) => c.contexts.includes(context))
          .map((c) => ({
            label: `${p.manifest.name} · ${c.label}`,
            action: () => {
              setExtension({
                pluginId: p.manifest.id,
                context: {
                  command: c.id,
                  view: context,
                  selection: textareaSelection || selection,
                  record,
                },
              });
              setView('extension');
            },
          })),
      );
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      title,
      items: extensions.length ? [...items, { label: '', separator: true }, ...extensions] : items,
    });
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        openSettings();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'r' &&
        selected &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLInputElement)
      ) {
        e.preventDefault();
        action('repeater', selected);
      }
      if (e.key === 'Escape') setContextMenu(undefined);
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [view, selected, settings]);
  if (error) return <Empty title="Glasses could not start">{error}</Empty>;
  if (!data || !settings || !status)
    return (
      <div className="boot">
        <Brand />
        <p>Preparing your local research workspace…</p>
      </div>
    );
  const dark = settings.theme === 'system' ? systemDark : settings.theme === 'dark';
  const hosts = [...new Set(records.map((r) => host(r.url)))];
  const enabledTools = plugins
    .filter((p) => p.enabled)
    .flatMap((p) => p.manifest.tools.map((t) => ({ plugin: p, tool: t })));
  const currentPlugin = plugins.find((p) => p.enabled && p.manifest.id === extension?.pluginId);
  const commands = [
    ...navigation.map((n) => ({ label: n.label, run: () => setView(n.id) })),
    { label: 'Settings', run: openSettings },
    {
      label: 'Try local research lab',
      run: () => {
        void invoke('demo');
        setView('traffic');
      },
    },
    {
      label: 'Open research browser',
      run: () => {
        void invoke('browser');
      },
    },
    {
      label: 'Import session / HAR',
      run: () => {
        void invoke('importSession');
      },
    },
    {
      label: 'Save session',
      run: () => {
        void invoke('exportSession');
      },
    },
  ];
  return (
    <div
      className={`app ${dark ? 'dark' : 'light'} palette-${settings.palette} density-${settings.density}`}
    >
      <header className={`titlebar ${data.platform === 'darwin' ? 'mac' : ''}`}>
        <div className="titlebar-brand">
          GLASSES <span>/</span> {data.testMode ? 'AUTOMATED TEST SESSION' : 'RESEARCH WORKSPACE'}
        </div>
        <div className="titlebar-actions">
          <button
            className={view === 'settings' ? 'selected-button' : ''}
            onClick={openSettings}
            aria-label="Open Settings"
          >
            <SettingsIcon size={15} />
            Settings
          </button>
          <button onClick={() => setPaletteOpen(true)} aria-label="Command palette">
            <Command size={13} />
            <span>K</span>
          </button>
        </div>
      </header>
      {view === 'settings' ? (
        <Settings
          data={data}
          saved={settings}
          onSave={setSettings}
          close={() => setView(previousView)}
          invoke={invoke}
          notify={notify}
          openPlugins={() => setView('plugins')}
        />
      ) : (
        <div className="workspace">
          <aside className="sidebar">
            <Brand />
            <button
              className="workspace-button"
              onClick={(e) =>
                menu(e, 'Workspace', [
                  {
                    label: 'Save session…',
                    action: () => {
                      void invoke('exportSession');
                    },
                  },
                  {
                    label: 'Import session / HAR…',
                    action: () => {
                      void invoke('importSession');
                    },
                  },
                  {
                    label: 'Export HAR…',
                    action: () => {
                      void invoke('exportHAR');
                    },
                  },
                ])
              }
            >
              Research workspace
              <ChevronDown size={14} />
            </button>
            <nav className="main-navigation">
              {navigation.map((n) => (
                <button
                  key={n.id}
                  className={view === n.id ? 'active' : ''}
                  onClick={() => setView(n.id)}
                >
                  <n.icon size={19} strokeWidth={1.6} />
                  <span>{n.label}</span>
                  {n.id === 'intercept' && status.pending > 0 && (
                    <b className="nav-badge">{status.pending}</b>
                  )}
                </button>
              ))}
            </nav>
            <div className="nav-section-label">EXTENSIONS</div>
            <nav className="main-navigation">
              <button
                className={view === 'plugins' ? 'active' : ''}
                onClick={() => setView('plugins')}
              >
                <Puzzle size={19} />
                <span>Plugins</span>
                {plugins.length > 0 && <span className="nav-count">{plugins.length}</span>}
              </button>
              <button
                className={view === 'community' ? 'active' : ''}
                onClick={() => setView('community')}
              >
                <Users size={19} />
                <span>Community</span>
              </button>
              {enabledTools.map(({ plugin, tool }) => (
                <button
                  key={plugin.manifest.id + tool.id}
                  className={
                    view === 'extension' &&
                    extension?.pluginId === plugin.manifest.id &&
                    extension.context.toolId === tool.id
                      ? 'active'
                      : ''
                  }
                  onClick={() => {
                    setExtension({
                      pluginId: plugin.manifest.id,
                      context: { command: 'open', toolId: tool.id, view: 'tool', record: selected },
                    });
                    setView('extension');
                  }}
                >
                  <Puzzle size={18} />
                  <span>{tool.label}</span>
                </button>
              ))}
            </nav>
            <div className="nav-section-label">
              TARGETS<span>{hosts.length}</span>
            </div>
            <div className="targets">
              <button
                className={!filterHost ? 'selected-host' : ''}
                onClick={() => {
                  setFilterHost('');
                  setView('traffic');
                }}
              >
                <Globe size={17} />
                All hosts
              </button>
              {hosts.map((h) => (
                <button
                  key={h}
                  className={`target-host ${filterHost === h ? 'selected-host' : ''}`}
                  onClick={() => {
                    setFilterHost(h);
                    setView('traffic');
                  }}
                  title={h}
                >
                  <span className="host-dot" />
                  <span>{h}</span>
                </button>
              ))}
              {!hosts.length && <p className="targets-empty">Hosts appear as traffic flows.</p>}
            </div>
          </aside>
          <main className="main-workspace">
            <div className="workspace-toolbar">
              <div className="workspace-heading">
                {view === 'traffic' ? (
                  <>
                    <h1>Traffic</h1>
                    <span className="muted mono">{records.length} requests</span>
                  </>
                ) : (
                  <div className="breadcrumb">
                    Workspace<span>/</span>
                    <strong>
                      {view === 'extension'
                        ? currentPlugin?.manifest.name
                        : navigation.find((n) => n.id === view)?.label ||
                          view[0].toUpperCase() + view.slice(1)}
                    </strong>
                  </div>
                )}
              </div>
              <div className="toolbar-actions">
                <button
                  className={status.running ? 'capture active-capture' : 'capture'}
                  onClick={() => invoke(status.running ? 'stop' : 'start')}
                  disabled={busy > 0 && view === 'traffic'}
                >
                  <span className={`status-dot ${status.running ? 'live' : ''}`} />
                  {status.running ? 'Capturing' : 'Start proxy'}
                </button>
                <button
                  aria-label="Toggle proxy"
                  aria-pressed={data.systemProxy.active}
                  className={data.systemProxy.active ? 'selected-button' : ''}
                  disabled={busy > 0 || !data.systemProxy.supported}
                  title={
                    data.testMode
                      ? 'System proxy changes are disabled in automated test sessions'
                      : data.systemProxy.supported
                        ? 'Route system HTTP/HTTPS and SOCKS traffic through Glasses, or restore saved network settings'
                        : 'Automatic system routing is available on macOS; configure other clients manually'
                  }
                  onClick={() => invoke('toggleProxy')}
                >
                  <Globe size={15} />
                  Toggle proxy{' '}
                  <span className="muted">{data.systemProxy.active ? 'On' : 'Off'}</span>
                </button>
                <div className="intercept-control">
                  <span>Intercept {status.intercept ? 'on' : 'off'}</span>
                  <Toggle
                    checked={status.intercept}
                    onChange={(v) => invoke('intercept', v)}
                    label="Intercept traffic"
                  />
                </div>
                <button className="primary" onClick={() => invoke('browser')}>
                  <ExternalLink size={15} />
                  Open browser
                </button>
              </div>
            </div>
            <div className="page-host" hidden={view !== 'repeater'}>
              <Repeater
                seed={seed}
                records={records}
                job={job}
                setJob={setJob}
                menu={menu}
                action={action}
                transform={transform}
                notify={notify}
                invoke={invoke}
              />
            </div>
            {view === 'traffic' && (
              <Traffic
                records={records}
                selected={selected}
                select={select}
                filterHost={filterHost}
                scope={settings.scope}
                menu={menu}
                action={action}
                transform={transform}
                notify={notify}
                invoke={invoke}
              />
            )}
            {view === 'intercept' && (
              <Intercept
                records={records}
                invoke={invoke}
                notify={notify}
                menu={menu}
                transform={transform}
              />
            )}
            {view === 'timeline' && (
              <Timeline records={records} selected={selected} menu={menu} action={action} />
            )}
            {view === 'tls' && <TLSInspector initialUrl={tlsUrl} notify={notify} menu={menu} />}
            {view === 'headers' && (
              <HeaderInspector
                records={records}
                selected={selected}
                select={select}
                action={action}
              />
            )}
            {view === 'rules' && (
              <Rules
                rules={rules}
                setRules={setRules}
                seed={ruleSeed}
                invoke={invoke}
                notify={notify}
              />
            )}
            {view === 'plugins' && (
              <Plugins plugins={plugins} setPlugins={setPlugins} invoke={invoke} notify={notify} />
            )}
            {view === 'community' && (
              <Community
                plugins={plugins}
                setPlugins={setPlugins}
                enabled={settings.communityEnabled}
                protocolRegistered={data.communityProtocolRegistered}
                intent={installIntent}
                dismissIntent={() => {
                  if (installIntent) void invoke('communityDismissIntent', installIntent.nonce);
                  setInstallIntent(undefined);
                }}
                connect={async () => {
                  const result = await invoke<{ settings: SettingsValue }>('settings', {
                    ...settings,
                    communityEnabled: true,
                  });
                  if (result) setSettings(result.settings);
                  return Boolean(result);
                }}
                openPlugins={() => setView('plugins')}
                invoke={invoke}
                notify={notify}
              />
            )}
            {view === 'extension' &&
              (currentPlugin && extension ? (
                <PluginView
                  key={currentPlugin.manifest.id + ':' + currentPlugin.manifest.version}
                  plugin={currentPlugin}
                  context={extension.context}
                  sendToRepeater={sendDraft}
                  transform={transform}
                  notify={notify}
                />
              ) : (
                <Empty title="Extension is unavailable">
                  Enable the extension from Plugins to open its tool.
                </Empty>
              ))}
          </main>
        </div>
      )}
      <footer className="statusbar">
        <span>
          <i className={`status-dot ${status.running ? 'live' : ''}`} />
          {status.running ? 'Proxy running' : 'Proxy stopped'}
        </span>
        <span className="mono">127.0.0.1:{status.proxyPort}</span>
        <span className="mono">SOCKS5 {status.socksEnabled ? `:${status.socksPort}` : 'off'}</span>
        {busy > 0 && <span className="working">Working…</span>}
        <div className="grow" />
        <button onClick={() => invoke('demo')}>
          <FlaskConical size={13} />
          Local lab
        </button>
        <span>
          <Shield size={13} />
          {data.ca.source === 'custom' ? 'Organization CA ready' : 'Local CA ready'}
        </span>
        <span>
          <Puzzle size={13} />
          {plugins.filter((p) => p.enabled).length} plugins
        </span>
        <span>v{data.version}</span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {contextMenu && <ContextMenu {...contextMenu} close={() => setContextMenu(undefined)} />}{' '}
      {transformation && (
        <TransformModal
          input={transformation.text}
          replace={transformation.replace}
          close={() => setTransformation(undefined)}
          notify={notify}
        />
      )}{' '}
      {paletteOpen && (
        <Modal title="Go anywhere" close={() => setPaletteOpen(false)}>
          <div className="command-palette">
            <SearchBox
              value={commandSearch}
              onChange={setCommandSearch}
              placeholder="Search tools and commands…"
            />
            {commands
              .filter((c) => c.label.toLowerCase().includes(commandSearch.toLowerCase()))
              .map((c) => (
                <button
                  key={c.label}
                  onClick={() => {
                    setPaletteOpen(false);
                    setCommandSearch('');
                    c.run();
                  }}
                >
                  {c.label}
                  <ArrowLeftRight size={14} />
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
