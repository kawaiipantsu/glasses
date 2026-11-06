import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Copy,
  Download,
  Ellipsis,
  Filter,
  FlaskConical,
  Globe,
  Radio,
  Search,
  Trash2,
} from 'lucide-react';
import { Code, Empty, IconButton, Method, Pill, SearchBox, StatusCode, Tabs } from './components';
import { api, asCurl, copy, headerText, host, pathname, size, time } from './utils';
import type { Body, MenuAction, TrafficRecord } from './types';
export type ShowMenu = (
  e: { clientX: number; clientY: number; preventDefault: () => void },
  title: string,
  items: MenuAction[],
) => void;
export type RecordAction = (action: string, record: TrafficRecord, extra?: unknown) => void;
export function requestActions(record: TrafficRecord, action: RecordAction): MenuAction[] {
  const http = /^https?:/.test(record.url);
  return [
    {
      label: 'Send to Repeater',
      shortcut: '⌘ R',
      disabled: !http,
      action: () => action('repeater', record),
    },
    {
      label: 'Intercept next matching request',
      disabled: !http,
      action: () => action('intercept-next', record),
    },
    { label: 'Show in Timeline', action: () => action('timeline', record) },
    {
      label: 'Inspect upstream TLS',
      disabled: !record.url.startsWith('https:'),
      action: () => action('tls', record),
    },
    {
      label: 'Check response headers',
      disabled: !http || !record.status,
      action: () => action('headers', record),
    },
    { label: '', separator: true },
    { label: 'Copy as cURL', disabled: !http, action: () => action('copy-curl', record) },
    { label: 'Copy URL', action: () => action('copy-url', record) },
  ];
}
export function InspectorPane({
  record,
  side,
  menu,
  action,
  transform,
  notify,
}: {
  record: TrafficRecord;
  side: 'request' | 'response';
  menu: ShowMenu;
  action: RecordAction;
  transform: (s: string) => void;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState(side === 'request' ? 'Headers' : 'Body');
  const [body, setBody] = useState<Body>({ text: '', base64: '', binary: false });
  const [pretty, setPretty] = useState(true);
  useEffect(() => {
    let active = true;
    api
      .invoke<Body>('body', { id: record.id, side })
      .then((b) => {
        if (active) setBody(b);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [record.id, record[(side + 'Body') as keyof TrafficRecord], side]);
  const headers = side === 'request' ? record.requestHeaders : record.responseHeaders;
  let text = body.binary
    ? body.base64
      ? `Binary content · ${size(body.bytes || 0)}\n\nUse Hex to inspect bytes, or save the original body.`
      : ''
    : body.text;
  if (pretty && !body.binary && text.length <= 512000) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {}
  }
  if (tab === 'Raw')
    text = `${side === 'request' ? `${record.method} ${pathname(record.url)} HTTP/1.1` : `HTTP/1.1 ${record.status}`}\n${headerText(headers)}\n\n${text}`;
  if (tab === 'Hex') {
    const binary = atob(body.base64 || '');
    text = Array.from({ length: Math.ceil(Math.min(binary.length, 65536) / 16) }, (_, i) => {
      const chunk = binary.slice(i * 16, i * 16 + 16);
      return `${(i * 16).toString(16).padStart(8, '0')}  ${[...chunk]
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(' ')
        .padEnd(47)}  ${chunk.replace(/[^\x20-\x7e]/g, '.')}`;
    }).join('\n');
    if (binary.length > 65536)
      text += '\n… Hex preview limited to 64 KB. Save the body for all captured bytes.';
  }
  const bodyMenu = (e: Parameters<ShowMenu>[0]) => {
    const selection = window.getSelection()?.toString() || '';
    const chosen = selection || text;
    menu(e, `${side === 'request' ? 'Request' : 'Response'} ${body.binary ? 'bytes' : 'text'}`, [
      {
        label: selection ? 'Copy selection' : 'Copy view',
        action: () => copy(chosen).then(() => notify('Copied')),
      },
      ...(!body.binary
        ? [
            { label: 'Encode / decode selection…', action: () => transform(chosen) },
            { label: 'Format / minify JSON…', action: () => transform(chosen) },
          ]
        : [
            {
              label: 'Copy as Base64',
              action: () => copy(body.base64).then(() => notify('Copied Base64')),
            },
          ]),
      {
        label: 'Save original body…',
        action: () =>
          api
            .invoke('saveBody', { id: record.id, side })
            .then((p) => {
              if (p) notify('Body saved');
            })
            .catch((e) => notify(e.message)),
      },
      { label: '', separator: true },
      {
        label: side === 'request' ? 'Edit request in Repeater' : 'Replay associated request',
        action: () => action('repeater', record),
      },
      ...(side === 'request' && selection
        ? [
            {
              label: 'Use selection as fuzz payload',
              action: () => action('fuzz-selection', record, selection),
            },
          ]
        : []),
      {
        label: 'Check response headers',
        disabled: !record.status,
        action: () => action('headers', record),
      },
    ]);
  };
  return (
    <section className="inspector-pane">
      <header>
        <strong>{side === 'request' ? 'Request' : 'Response'}</strong>
        {side === 'response' && (
          <span className="response-meta">
            <StatusCode value={record.status} />
            <span>{time(record.duration)}</span>
            <span>{size(record.responseBytes)}</span>
          </span>
        )}
        <IconButton label={`${side} actions`} onClick={(e) => bodyMenu(e)}>
          <Ellipsis size={17} />
        </IconButton>
      </header>
      <div className="pane-tabs">
        <Tabs items={['Headers', 'Body', 'Raw', 'Hex']} value={tab} onChange={setTab} />
        {tab === 'Body' && !body.binary && (
          <button
            className={`text-button ${pretty ? 'accent-text' : ''}`}
            onClick={() => setPretty(!pretty)}
          >
            {pretty ? 'Pretty' : 'Original'}
          </button>
        )}
      </div>
      <div className="inspector-content">
        {record.truncated && side === 'response' && (
          <div className="inline-note">
            Preview truncated · {size(record.responseBytes)} received
          </div>
        )}
        {body.error && <div className="inline-note">{body.error}</div>}
        {tab === 'Headers' ? (
          <div className="header-list">
            {Object.entries(headers).map(([name, value]) => (
              <div
                className="header-row"
                key={name}
                onContextMenu={(e) =>
                  menu(e, `${side} header`, [
                    { label: 'Copy header', action: () => copy(`${name}: ${value}`) },
                    { label: 'Copy value', action: () => copy(String(value)) },
                    { label: 'Encode / decode value…', action: () => transform(String(value)) },
                    { label: '', separator: true },
                    ...(side === 'request'
                      ? [
                          {
                            label: 'Edit / remove in Repeater',
                            action: () => action('repeater', record),
                          },
                        ]
                      : [
                          {
                            label: 'Inspect header hardening',
                            action: () => action('headers', record),
                          },
                        ]),
                    {
                      label: `Create ${side} rewrite rule…`,
                      action: () =>
                        action('rule', record, { phase: side, header: name, value: String(value) }),
                    },
                  ])
                }
              >
                <span>{name}</span>
                <span>{Array.isArray(value) ? value.join('\n') : value}</span>
              </div>
            ))}
            {!Object.keys(headers).length && (
              <div className="subtle-empty">
                {record.state === 'pending' ? 'Waiting for headers…' : 'No headers captured'}
              </div>
            )}
          </div>
        ) : text ? (
          <Code text={text} onContextMenu={bodyMenu} />
        ) : (
          <div className="subtle-empty">
            {record.state === 'pending' ? 'Waiting for body…' : 'This message has no body'}
          </div>
        )}
      </div>
    </section>
  );
}
export function Inspector({
  record,
  menu,
  action,
  transform,
  notify,
}: {
  record?: TrafficRecord;
  menu: ShowMenu;
  action: RecordAction;
  transform: (s: string) => void;
  notify: (s: string) => void;
}) {
  const [split, setSplit] = useState(50);
  if (!record)
    return (
      <Empty title="A closer look starts here">
        Select a request to inspect headers, bodies and connection details.
      </Empty>
    );
  return (
    <div className="inspector">
      <div className="request-summary">
        <Method value={record.method} />
        <span title={record.url}>{record.url}</span>
        <div className="summary-actions">
          <button onClick={() => action('copy-curl', record)}>
            <Copy size={14} />
            Copy as cURL
          </button>
          <button onClick={() => action('repeater', record)}>
            <ArrowRight size={15} />
            Send to Repeater
          </button>
        </div>
      </div>
      {record.error && <div className="error-banner">{record.error}</div>}
      {record.note && <div className="inline-note">{record.note}</div>}
      {record.appliedRules.length > 0 && (
        <div className="inline-note">Applied: {record.appliedRules.join(' · ')}</div>
      )}
      <div
        className="inspector-split"
        style={{ gridTemplateColumns: `minmax(0,${split}fr) 5px minmax(0,${100 - split}fr)` }}
      >
        <InspectorPane
          record={record}
          side="request"
          menu={menu}
          action={action}
          transform={transform}
          notify={notify}
        />
        <div
          className="splitter vertical"
          role="separator"
          aria-label="Resize request and response panes"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit(Math.max(25, split - 5));
            if (e.key === 'ArrowRight') setSplit(Math.min(75, split + 5));
          }}
          onPointerDown={(e) => {
            const box = e.currentTarget.parentElement!.getBoundingClientRect();
            const move = (e: PointerEvent) =>
              setSplit(Math.max(25, Math.min(75, ((e.clientX - box.left) / box.width) * 100)));
            const end = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', end);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', end);
          }}
        />
        <InspectorPane
          record={record}
          side="response"
          menu={menu}
          action={action}
          transform={transform}
          notify={notify}
        />
      </div>
    </div>
  );
}
export default function Traffic({
  records,
  selected,
  select,
  filterHost,
  scope,
  menu,
  action,
  transform,
  notify,
  invoke,
}: {
  records: TrafficRecord[];
  selected?: TrafficRecord;
  select: (id: string) => void;
  filterHost: string;
  scope: string;
  menu: ShowMenu;
  action: RecordAction;
  transform: (s: string) => void;
  notify: (s: string) => void;
  invoke: (action: string, payload?: unknown) => Promise<any>;
}) {
  const [search, setSearch] = useState(''),
    [protocol, setProtocol] = useState('All'),
    [inScope, setInScope] = useState(false),
    [height, setHeight] = useState(43),
    [page, setPage] = useState(0);
  const filtered = records
    .filter(
      (r) =>
        (!filterHost || host(r.url) === filterHost) &&
        (protocol === 'All' || r.protocol === protocol) &&
        (!inScope ||
          scope
            .split(/[\n,]/)
            .filter(Boolean)
            .some((s) => r.url.includes(s.trim()))) &&
        `${r.url} ${r.method} ${r.status}`.toLowerCase().includes(search.toLowerCase()),
    )
    .reverse();
  useEffect(() => setPage(0), [search, protocol, inScope, filterHost]);
  return (
    <div className="traffic-workspace">
      <div className="filter-bar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Filter by URL, host, method or status…"
        />
        <div className="segmented">
          {['All', 'HTTP', 'HTTPS', 'WebSocket', 'SOCKS5'].map((p) => (
            <button
              key={p}
              className={protocol === p ? 'active' : ''}
              onClick={() => setProtocol(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          className={inScope ? 'selected-button' : ''}
          onClick={() => setInScope(!inScope)}
          title={scope || 'Configure target scope in Settings'}
        >
          <Filter size={14} />
          In scope
        </button>
        <IconButton label="Clear traffic" onClick={() => invoke('clear')}>
          <Trash2 size={16} />
        </IconButton>
        <IconButton
          label="Export traffic"
          onClick={(e) =>
            menu(e, 'Export session', [
              {
                label: 'Save Glasses session…',
                action: () => {
                  void invoke('exportSession');
                },
              },
              {
                label: 'Export HAR…',
                action: () => {
                  void invoke('exportHAR');
                },
              },
              {
                label: 'Import session / HAR…',
                action: () => {
                  void invoke('importSession');
                },
              },
            ])
          }
        >
          <Download size={16} />
        </IconButton>
      </div>
      <div className="traffic-table-area" style={{ height: `${height}%` }}>
        {!records.length ? (
          <Empty
            icon={<Radio size={30} />}
            title="Your traffic, in focus"
            action={
              <div className="empty-actions">
                <button className="primary" onClick={() => invoke('demo')}>
                  <FlaskConical size={15} />
                  Try the local lab
                </button>
                <button onClick={() => invoke('importSession')}>Open a session</button>
              </div>
            }
          >
            Start capturing and open the research browser, or explore a local test site to get
            familiar with Glasses.
          </Empty>
        ) : (
          <>
            <div className="table-scroll">
              <table className="traffic-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Method</th>
                    <th>Host</th>
                    <th>Path</th>
                    <th>Status</th>
                    <th>Size</th>
                    <th>Time</th>
                    <th>Waterfall</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(page * 150, page * 150 + 150).map((r) => (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      aria-selected={selected?.id === r.id}
                      className={`${selected?.id === r.id ? 'selected' : ''} ${r.state === 'intercepted' ? 'paused-row' : ''}`}
                      onClick={() => select(r.id)}
                      onDoubleClick={() => action('repeater', r)}
                      onContextMenu={(e) => {
                        select(r.id);
                        menu(e, 'Request actions', requestActions(r, action));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') select(r.id);
                        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                          const b = e.currentTarget.getBoundingClientRect();
                          menu(
                            {
                              clientX: b.x + 100,
                              clientY: b.y,
                              preventDefault: () => e.preventDefault(),
                            },
                            'Request actions',
                            requestActions(r, action),
                          );
                        }
                      }}
                    >
                      <td className="mono muted">{r.number}</td>
                      <td>
                        <Method value={r.method} />
                      </td>
                      <td title={host(r.url)}>{host(r.url)}</td>
                      <td title={r.url} className="path-cell">
                        {pathname(r.url)}
                      </td>
                      <td>
                        {r.state === 'intercepted' ? (
                          <Pill tone="amber">Paused</Pill>
                        ) : r.error ? (
                          <Pill tone="red">Error</Pill>
                        ) : (
                          <StatusCode value={r.status} />
                        )}
                      </td>
                      <td className="mono">{size(r.responseBytes)}</td>
                      <td className="mono">{time(r.duration)}</td>
                      <td>
                        <div className="mini-waterfall">
                          <span
                            style={{ width: `${Math.max(5, Math.min(100, r.duration / 5))}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <div className="subtle-empty">No matching requests. Try a broader filter.</div>
              )}
            </div>
            {filtered.length > 150 && (
              <div className="pagination">
                <span>
                  {page * 150 + 1}–{Math.min((page + 1) * 150, filtered.length)} of{' '}
                  {filtered.length}
                </span>
                <button disabled={!page} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <button
                  disabled={(page + 1) * 150 >= filtered.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <div
        className="splitter horizontal"
        role="separator"
        tabIndex={0}
        aria-label="Resize traffic table"
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') setHeight(Math.max(20, height - 5));
          if (e.key === 'ArrowDown') setHeight(Math.min(65, height + 5));
        }}
        onPointerDown={(e) => {
          const box = e.currentTarget.parentElement!.getBoundingClientRect();
          const move = (e: PointerEvent) =>
            setHeight(Math.max(20, Math.min(65, ((e.clientY - box.top) / box.height) * 100)));
          const end = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', end);
        }}
      />
      <Inspector
        record={selected}
        menu={menu}
        action={action}
        transform={transform}
        notify={notify}
      />
    </div>
  );
}
