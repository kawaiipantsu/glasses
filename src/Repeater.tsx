import { useEffect, useState } from 'react';
import { ArrowRight, Braces, Copy, Play, RotateCcw, Square, Zap } from 'lucide-react';
import type { Body, Job, RequestDraft, TrafficRecord } from './types';
import { api, copy, decode, headerText, parseHeaders, size, time } from './utils';
import { Code, Empty, Method, Pill, SectionHead, StatusCode, Tabs } from './components';
import { Inspector, type RecordAction, type ShowMenu } from './Traffic';
export interface RepeaterSeed {
  record: TrafficRecord;
  nonce: number;
  fuzz?: string;
  draft?: RequestDraft;
}
export default function Repeater({
  seed,
  records,
  job,
  setJob,
  menu,
  action,
  transform,
  notify,
  invoke,
}: {
  seed?: RepeaterSeed;
  records: TrafficRecord[];
  job?: Job;
  setJob: (j: Job) => void;
  menu: ShowMenu;
  action: RecordAction;
  transform: (s: string, replace?: (s: string) => void) => void;
  notify: (s: string) => void;
  invoke: <T = any>(a: string, v?: unknown) => Promise<T | undefined>;
}) {
  const [url, setUrl] = useState(''),
    [method, setMethod] = useState('GET'),
    [headers, setHeaders] = useState('accept: application/json'),
    [body, setBody] = useState(''),
    [bodyEncoding, setBodyEncoding] = useState<'utf8' | 'base64'>('utf8'),
    [tab, setTab] = useState('Headers'),
    [iterations, setIterations] = useState(1),
    [concurrency, setConcurrency] = useState(1),
    [delay, setDelay] = useState(100),
    [payloads, setPayloads] = useState(''),
    [sending, setSending] = useState(false),
    [resultId, setResultId] = useState<string>(),
    [mode, setMode] = useState('Single request');
  useEffect(() => {
    if (!seed) return;
    const r = seed.record;
    setUrl(r.url);
    setMethod(r.method);
    setHeaders(headerText(r.requestHeaders));
    setBody(seed.draft?.body ?? decode(r.requestBody));
    setBodyEncoding(seed.draft?.bodyEncoding || 'utf8');
    setMode(seed.fuzz ? 'Iterations / fuzz' : 'Single request');
    if (seed.fuzz) {
      setPayloads(seed.fuzz);
      setIterations(3);
    }
    if (!seed.draft)
      api
        .invoke<Body>('body', { id: r.id, side: 'request' })
        .then((b) => {
          setBody(b.binary ? b.base64 : b.text);
          setBodyEncoding(b.binary ? 'base64' : 'utf8');
        })
        .catch(() => {});
  }, [seed?.nonce]);
  const result = records.find((r) => r.id === resultId);
  const draft = (): RequestDraft => ({
    url,
    method,
    headers: parseHeaders(headers),
    body,
    bodyEncoding,
  });
  const send = async () => {
    try {
      const request = draft();
      setSending(true);
      if (mode === 'Single request') {
        const r = await invoke<TrafficRecord>('replay', request);
        if (r) setResultId(r.id);
      } else {
        const j = await invoke<Job>('run', {
          request,
          iterations,
          concurrency,
          delayMs: delay,
          payloads: payloads.split('\n').filter((_, i, a) => i < a.length - 1 || a[i] !== ''),
        });
        if (j) setJob(j);
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  const editMenu = (
    e: React.MouseEvent<HTMLTextAreaElement>,
    value: string,
    set: (s: string) => void,
    canFuzz: boolean,
  ) => {
    const node = e.currentTarget,
      start = node.selectionStart,
      end = node.selectionEnd,
      selected = value.slice(start, end);
    const text = selected || value;
    const replace = (s: string) => set(selected ? value.slice(0, start) + s + value.slice(end) : s);
    menu(e, 'Editable request text', [
      { label: selected ? 'Copy selection' : 'Copy all', action: () => copy(text) },
      {
        label: 'Paste at cursor',
        action: () => {
          navigator.clipboard
            .readText()
            .then((s) => set(value.slice(0, start) + s + value.slice(end)))
            .catch(() => notify('Clipboard read was unavailable'));
        },
      },
      { label: 'Encode / decode…', action: () => transform(text, replace) },
      { label: 'Format / minify JSON…', action: () => transform(text, replace) },
      ...(canFuzz
        ? [
            {
              label: 'Mark as fuzz payload',
              disabled: !selected,
              action: () => {
                replace('{{payload}}');
                setPayloads(selected);
                setMode('Iterations / fuzz');
                setIterations(Math.max(3, iterations));
                setTab('Payloads');
              },
            },
          ]
        : []),
      { label: '', separator: true },
      {
        label: 'Copy as cURL',
        action: () => {
          try {
            action('copy-draft', seed?.record || ({} as TrafficRecord), draft());
          } catch (e) {
            notify((e as Error).message);
          }
        },
      },
    ]);
  };
  const running = job && !job.done;
  return (
    <div className="tool-page repeater-page">
      <SectionHead
        eyebrow="COMPOSE · REPLAY · COMPARE"
        title="Repeater"
        description="Make a change. Send it. Understand the difference."
      >
        <Pill tone="neutral">HTTP / HTTPS</Pill>
      </SectionHead>
      <div className="request-composer">
        <select
          aria-label="Request method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          className="mono"
          aria-label="Request URL"
          placeholder="https://example.com/api/resource"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="primary" disabled={!url || sending || !!running} onClick={send}>
          <Play size={15} />
          {sending ? 'Sending…' : mode === 'Single request' ? 'Send request' : 'Run iterations'}
        </button>
        {running && (
          <button className="danger-button" onClick={() => invoke('cancelRun', job.id)}>
            <Square size={14} />
            Stop run
          </button>
        )}
      </div>
      <div className="repeater-options">
        <div className="segmented">
          {['Single request', 'Iterations / fuzz'].map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m}
            </button>
          ))}
        </div>
        {mode !== 'Single request' && (
          <>
            <label>
              Iterations
              <input
                type="number"
                min={1}
                max={1000}
                value={iterations}
                onChange={(e) => setIterations(Number(e.target.value))}
              />
            </label>
            <label>
              Concurrency
              <input
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              />
            </label>
            <label>
              Delay / worker
              <input
                type="number"
                min={0}
                max={60000}
                value={delay}
                onChange={(e) => setDelay(Number(e.target.value))}
              />
              <span>ms</span>
            </label>
          </>
        )}
      </div>
      <div className="repeater-editors">
        <section className="editor-card">
          <div className="pane-tabs">
            <Tabs items={['Headers', 'Body', 'Payloads']} value={tab} onChange={setTab} />
            {tab === 'Body' && (
              <select
                aria-label="Request body encoding"
                value={bodyEncoding}
                onChange={(e) => setBodyEncoding(e.target.value as 'utf8' | 'base64')}
              >
                <option value="utf8">UTF-8</option>
                <option value="base64">Base64 bytes</option>
              </select>
            )}
          </div>
          {tab === 'Headers' ? (
            <textarea
              className="editor"
              spellCheck={false}
              aria-label="Request headers"
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              onContextMenu={(e) => editMenu(e, headers, setHeaders, true)}
            />
          ) : tab === 'Body' ? (
            <textarea
              className="editor"
              spellCheck={false}
              aria-label="Request body"
              placeholder="Request body… Right-click a selection for transformations."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onContextMenu={(e) => editMenu(e, body, setBody, bodyEncoding === 'utf8')}
            />
          ) : (
            <>
              <p className="editor-hint">
                One payload per line. Use <code>{'{{payload}}'}</code> in the URL, header values, or
                body. <code>{'{{iteration}}'}</code> is the 1-based index. Payloads cycle; encode
                URL values explicitly.
              </p>
              <textarea
                className="editor"
                aria-label="Fuzz payloads"
                placeholder="first-value&#10;second-value&#10;third-value"
                value={payloads}
                onChange={(e) => setPayloads(e.target.value)}
              />
            </>
          )}
        </section>
        <section className="editor-card results-card">
          <header>
            <strong>Run results</strong>
            {job ? (
              <Pill tone={job.cancelled ? 'amber' : job.done ? 'green' : ''}>
                {job.cancelled ? 'Cancelled' : job.done ? 'Complete' : 'Running'} · {job.completed}/
                {job.total}
              </Pill>
            ) : (
              <span className="muted">Every iteration, individually inspectable</span>
            )}
          </header>
          {job?.results.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Payload</th>
                    <th>Status</th>
                    <th>Size</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {job.results.map((r) => (
                    <tr
                      key={r.iteration}
                      className={r.recordId === resultId ? 'selected' : ''}
                      onClick={() => setResultId(r.recordId)}
                      onContextMenu={(e) => {
                        const record = records.find((x) => x.id === r.recordId);
                        if (record)
                          menu(e, 'Iteration result', [
                            { label: 'Inspect response', action: () => setResultId(r.recordId) },
                            { label: 'Send to Repeater', action: () => action('repeater', record) },
                            { label: 'Show in Timeline', action: () => action('timeline', record) },
                            { label: 'Check headers', action: () => action('headers', record) },
                          ]);
                      }}
                    >
                      <td>{r.iteration}</td>
                      <td title={r.error || r.payload}>
                        {r.error ? <span className="error-text">{r.error}</span> : r.payload || '—'}
                      </td>
                      <td>
                        <StatusCode value={r.status || 0} />
                      </td>
                      <td>{size(r.bytes || 0)}</td>
                      <td>{time(r.duration || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="subtle-empty">
              <Zap size={24} />
              <p>
                Send a request or start a payload run.
                <br />
                Results will appear here.
              </p>
            </div>
          )}
        </section>
      </div>
      <div className="repeater-response">
        <Inspector
          record={result}
          menu={menu}
          action={action}
          transform={transform}
          notify={notify}
        />
      </div>
    </div>
  );
}
function InterceptEditor({
  record,
  invoke,
  notify,
  menu,
  transform,
}: {
  record: TrafficRecord;
  invoke: <T = any>(a: string, v?: unknown) => Promise<T | undefined>;
  notify: (s: string) => void;
  menu: ShowMenu;
  transform: (s: string, replace?: (s: string) => void) => void;
}) {
  const phase = record.interceptPhase!;
  const [url, setUrl] = useState(record.url),
    [method, setMethod] = useState(record.method),
    [status, setStatus] = useState(record.status),
    [headers, setHeaders] = useState(
      headerText(phase === 'request' ? record.requestHeaders : record.responseHeaders),
    ),
    [body, setBody] = useState(''),
    [encoding, setEncoding] = useState<'utf8' | 'base64'>('utf8'),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .invoke<Body>('body', { id: record.id, side: phase })
      .then((b) => {
        setBody(b.binary ? b.base64 : b.text);
        setEncoding(b.binary ? 'base64' : 'utf8');
      })
      .catch((e) => notify(e.message));
  }, [record.id, phase]);
  const forward = async () => {
    try {
      const parsed = parseHeaders(headers);
      setBusy(true);
      await invoke('resolve', {
        id: record.id,
        edit: {
          action: 'forward',
          ...(phase === 'request'
            ? { request: { url, method, headers: parsed, body, bodyEncoding: encoding } }
            : { response: { status, headers: parsed, body, bodyEncoding: encoding } }),
        },
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="intercept-editor">
      <div className="intercept-banner">
        <span className="pulse amber-dot" />
        <strong>
          {phase === 'request'
            ? 'Request paused before upstream'
            : 'Response paused before delivery'}
        </strong>
        <span className="muted">Edit, then forward or drop.</span>
        <div className="grow" />
        <button
          className="danger-button"
          onClick={() => invoke('resolve', { id: record.id, edit: { action: 'drop' } })}
        >
          Drop
        </button>
        <button className="primary" disabled={busy} onClick={forward}>
          <ArrowRight size={15} />
          Forward
        </button>
      </div>
      <div className="request-composer">
        {phase === 'request' ? (
          <>
            <input
              aria-label="Intercept method"
              className="method-input"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            />
            <input
              aria-label="Intercept URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </>
        ) : (
          <>
            <label>
              Status{' '}
              <input
                aria-label="Intercept response status"
                type="number"
                min={200}
                max={599}
                value={status}
                onChange={(e) => setStatus(Number(e.target.value))}
              />
            </label>
            <span className="mono truncate">{record.url}</span>
          </>
        )}
      </div>
      <div className="intercept-fields">
        <label>
          Headers
          <textarea
            className="editor"
            spellCheck={false}
            aria-label="Intercept headers"
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
          />
        </label>
        <label>
          Body <span className="muted">{encoding}</span>
          <textarea
            className="editor"
            spellCheck={false}
            aria-label="Intercept body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onContextMenu={(e) => {
              const start = e.currentTarget.selectionStart,
                end = e.currentTarget.selectionEnd;
              const selected = body.slice(start, end);
              menu(e, 'Intercepted body', [
                { label: 'Copy selection', action: () => copy(selected || body) },
                {
                  label: 'Encode / decode…',
                  action: () =>
                    transform(selected || body, (v) =>
                      setBody(selected ? body.slice(0, start) + v + body.slice(end) : v),
                    ),
                },
              ]);
            }}
          />
        </label>
      </div>
    </div>
  );
}
export function Intercept({
  records,
  invoke,
  notify,
  menu,
  transform,
}: {
  records: TrafficRecord[];
  invoke: <T = any>(a: string, v?: unknown) => Promise<T | undefined>;
  notify: (s: string) => void;
  menu: ShowMenu;
  transform: (s: string, replace?: (s: string) => void) => void;
}) {
  const pending = records.filter((r) => r.state === 'intercepted');
  const [id, setId] = useState<string>();
  const selected = pending.find((r) => r.id === id) || pending[0];
  return (
    <div className="tool-page">
      <SectionHead
        eyebrow="PAUSE · INSPECT · MODIFY"
        title="Intercept"
        description="Hold requests or responses at the proxy boundary."
      >
        <Pill tone="amber">{pending.length} queued</Pill>
      </SectionHead>
      {pending.length ? (
        <>
          <div className="intercept-queue">
            {pending.map((r) => (
              <button
                key={r.id}
                className={r.id === selected?.id ? 'selected-button' : ''}
                onClick={() => setId(r.id)}
              >
                <Method value={r.method} />
                <span className="truncate">{r.url}</span>
                <Pill>{r.interceptPhase}</Pill>
              </button>
            ))}
          </div>
          {selected && (
            <InterceptEditor
              key={selected.id + selected.interceptPhase}
              record={selected}
              invoke={invoke}
              notify={notify}
              menu={menu}
              transform={transform}
            />
          )}
        </>
      ) : (
        <Empty title="Ready when you are">
          Enable Intercept in the toolbar to pause matching traffic. Choose request, response, or
          both phases and a URL filter in Settings → Proxy & interception.
        </Empty>
      )}
    </div>
  );
}
