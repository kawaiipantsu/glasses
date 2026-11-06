import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  LockKeyhole,
  Shield,
  ShieldAlert,
  Timer,
} from 'lucide-react';
import type { Finding, TrafficRecord } from './types';
import { Code, Empty, Method, Pill, SectionHead, StatusCode, Tabs } from './components';
import { api, copy, host, pathname, size, time } from './utils';
import { requestActions, type RecordAction, type ShowMenu } from './Traffic';
export function Timeline({
  records,
  selected,
  menu,
  action,
}: {
  records: TrafficRecord[];
  selected?: TrafficRecord;
  menu: ShowMenu;
  action: RecordAction;
}) {
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (selected) setFilter(host(selected.url));
  }, [selected?.id]);
  const all = records.filter((r) => r.status && r.source !== 'socks');
  const hosts = [...new Set(all.map((r) => host(r.url)))];
  const rows = all.filter((r) => !filter || host(r.url) === filter);
  const start = Math.min(...rows.map((r) => Date.parse(r.startedAt)));
  const end = Math.max(...rows.map((r) => Date.parse(r.startedAt) + r.duration));
  const span = Math.max(1, end - start);
  const maxDuration = Math.max(1, ...rows.map((r) => r.duration));
  const [mode, setMode] = useState('Page waterfall');
  const phases = (r: TrafficRecord) => {
    const t = r.timings;
    const values = [
      { name: 'DNS', value: t.dns },
      {
        name: 'Connect',
        value: t.connect == null ? undefined : Math.max(0, t.connect - (t.dns ?? 0)),
      },
      { name: 'TLS', value: t.tls == null ? undefined : Math.max(0, t.tls - (t.connect ?? 0)) },
      {
        name: 'Wait',
        value:
          t.firstByte == null ? undefined : Math.max(0, t.firstByte - (t.tls ?? t.connect ?? 0)),
      },
      {
        name: 'Download',
        value: t.firstByte == null ? undefined : Math.max(0, r.duration - t.firstByte),
      },
    ];
    return values;
  };
  return (
    <div className="tool-page">
      <SectionHead
        eyebrow="MEASURE · UNDERSTAND"
        title="Site Timeline"
        description="Connection timing and response speed, observed by your proxy."
      >
        <select
          aria-label="Timeline host"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All hosts</option>
          {hosts.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </SectionHead>
      {!rows.length ? (
        <Empty icon={<Activity size={32} />} title="See where the time goes">
          Capture or replay requests to build a timeline. No synthetic performance scores.
        </Empty>
      ) : (
        <>
          <div className="metric-grid">
            <div>
              <span>REQUESTS</span>
              <strong>{rows.length}</strong>
              <small>{filter || `${hosts.length} hosts`}</small>
            </div>
            <div>
              <span>OBSERVED WINDOW</span>
              <strong>{time(span)}</strong>
              <small>First start → last response</small>
            </div>
            <div>
              <span>TRANSFERRED</span>
              <strong>{size(rows.reduce((a, r) => a + r.responseBytes, 0))}</strong>
              <small>Response bytes, before decoding</small>
            </div>
            <div>
              <span>MEDIAN RESPONSE</span>
              <strong>
                {time(
                  rows.map((r) => r.duration).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
                )}
              </strong>
              <small>Upstream request duration</small>
            </div>
          </div>
          <div className="timeline-toolbar">
            <Tabs
              items={['Page waterfall', 'Duration comparison']}
              value={mode}
              onChange={setMode}
            />
            <div className="phase-legend">
              {['DNS', 'Connect', 'TLS', 'Wait', 'Download'].map((p, i) => (
                <span key={p}>
                  <i className={`phase-${i}`} />
                  {p}
                </span>
              ))}
            </div>
          </div>
          <div className="timeline-chart">
            <div className="timeline-ruler">
              <span>REQUEST</span>
              <div>
                <span>0</span>
                <span>{time((mode === 'Page waterfall' ? span : maxDuration) / 2)}</span>
                <span>{time(mode === 'Page waterfall' ? span : maxDuration)}</span>
              </div>
            </div>
            {rows.map((r) => (
              <div
                key={r.id}
                className={`timeline-row ${selected?.id === r.id ? 'selected' : ''}`}
                onClick={() => action('traffic', r)}
                onContextMenu={(e) =>
                  menu(e, 'Timeline request', [
                    ...requestActions(r, action),
                    {
                      label: 'Copy timing data',
                      action: () =>
                        copy(
                          JSON.stringify(
                            { url: r.url, timings: r.timings, duration: r.duration },
                            null,
                            2,
                          ),
                        ),
                    },
                  ])
                }
              >
                <div className="timeline-label">
                  <Method value={r.method} />
                  <span title={r.url}>{pathname(r.url)}</span>
                  <StatusCode value={r.status} />
                </div>
                <div className="timeline-track">
                  <div
                    className="timing-bar"
                    title={phases(r)
                      .map((p) => `${p.name}: ${p.value == null ? 'unavailable' : time(p.value)}`)
                      .join(' · ')}
                    style={{
                      left:
                        mode === 'Page waterfall'
                          ? `${((Date.parse(r.startedAt) - start) / span) * 100}%`
                          : '0%',
                      width: `${Math.max(0.3, (r.duration / (mode === 'Page waterfall' ? span : maxDuration)) * 100)}%`,
                    }}
                  >
                    {phases(r).map(
                      (p, i) =>
                        p.value != null &&
                        p.value > 0 && (
                          <span
                            key={p.name}
                            className={`phase-${i}`}
                            style={{ flex: p.value }}
                            title={`${p.name}: ${time(p.value)}`}
                          />
                        ),
                    )}
                  </div>
                  <span className="timing-duration">{time(r.duration)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="inline-note">
            Timings describe the proxy’s upstream connection. Browser rendering, DNS cache behavior,
            HTTP/2 multiplexing, and page-load milestones are not measured. Missing phases on
            imported sessions are unavailable.
          </div>
        </>
      )}
    </div>
  );
}
interface TLSReport {
  host: string;
  port: number;
  protocol: string;
  cipher: { name: string; version: string };
  alpn: string;
  authorized: boolean;
  authorizationError: string | null;
  handshakeMs: number;
  checkedAt: string;
  chain: {
    subject: Record<string, string>;
    issuer: Record<string, string>;
    san: string;
    validFrom: string;
    validTo: string;
    fingerprint: string;
    serialNumber: string;
    bits: number;
    pem: string;
  }[];
}
export function TLSInspector({
  initialUrl,
  notify,
  menu,
}: {
  initialUrl?: string;
  notify: (s: string) => void;
  menu: ShowMenu;
}) {
  const [url, setUrl] = useState(initialUrl || ''),
    [report, setReport] = useState<TLSReport>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [certIndex, setCertIndex] = useState(0);
  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);
  const inspect = async () => {
    setBusy(true);
    setError('');
    setReport(undefined);
    try {
      setReport(await api.invoke<TLSReport>('inspectTLS', url));
      setCertIndex(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cert = report?.chain[certIndex];
  return (
    <div className="tool-page">
      <SectionHead
        eyebrow="IDENTITY · TRUST · TRANSPORT"
        title="SSL / TLS Inspector"
        description="Inspect the real upstream endpoint, independently of the proxy’s local certificate."
      />
      <div className="request-composer">
        <LockKeyhole size={18} />
        <input
          aria-label="TLS endpoint"
          placeholder="https://example.com:443"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void inspect();
          }}
        />
        <button className="primary" disabled={!url || busy} onClick={inspect}>
          <Shield size={16} />
          {busy ? 'Connecting…' : 'Inspect TLS'}
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {report ? (
        <>
          <div className={`trust-banner ${report.authorized ? 'trusted' : 'untrusted'}`}>
            {report.authorized ? <CheckCircle2 size={23} /> : <ShieldAlert size={23} />}
            <div>
              <strong>
                {report.authorized
                  ? 'Certificate chain trusted'
                  : 'Certificate validation needs attention'}
              </strong>
              <p>{report.authorizationError || `Identity verified for ${report.host}`}</p>
            </div>
            <Pill>{new Date(report.checkedAt).toLocaleTimeString()}</Pill>
          </div>
          <div className="metric-grid">
            <div>
              <span>PROTOCOL</span>
              <strong>{report.protocol}</strong>
              <small>Negotiated version</small>
            </div>
            <div>
              <span>HANDSHAKE</span>
              <strong>{time(report.handshakeMs)}</strong>
              <small>Includes lookup and TCP connect</small>
            </div>
            <div>
              <span>APPLICATION PROTOCOL</span>
              <strong>{report.alpn}</strong>
              <small>ALPN negotiation</small>
            </div>
            <div>
              <span>CIPHER</span>
              <strong className="small-value">{report.cipher.name}</strong>
              <small>{report.cipher.version}</small>
            </div>
          </div>
          <div className="certificate-layout">
            <aside>
              <div className="eyebrow">CERTIFICATE CHAIN</div>
              {report.chain.map((c, i) => (
                <button
                  className={certIndex === i ? 'active' : ''}
                  key={i}
                  onClick={() => setCertIndex(i)}
                >
                  <Shield size={17} />
                  <span>
                    {c.subject.CN || `Certificate ${i + 1}`}
                    <small>{i === 0 ? 'Leaf certificate' : 'Issuer'}</small>
                  </span>
                </button>
              ))}
            </aside>
            {cert && (
              <section
                className="certificate-detail"
                onContextMenu={(e) =>
                  menu(e, 'Certificate', [
                    { label: 'Copy fingerprint', action: () => copy(cert.fingerprint) },
                    { label: 'Copy subject alternative names', action: () => copy(cert.san || '') },
                    { label: 'Copy PEM certificate', action: () => copy(cert.pem) },
                    {
                      label: 'Export certificate…',
                      action: () =>
                        api
                          .invoke('saveText', { name: 'certificate.pem', text: cert.pem })
                          .catch((e) => notify(e.message)),
                    },
                  ])
                }
              >
                <h2>{cert.subject.CN || report.host}</h2>
                <div className="definition-list">
                  {[
                    [
                      'Subject',
                      Object.entries(cert.subject)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(', '),
                    ],
                    [
                      'Issuer',
                      Object.entries(cert.issuer)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(', '),
                    ],
                    ['Valid from', cert.validFrom],
                    ['Valid until', cert.validTo],
                    ['Alternative names', cert.san || 'None'],
                    ['SHA-256 fingerprint', cert.fingerprint],
                    ['Serial number', cert.serialNumber],
                    ['Public key', cert.bits ? `${cert.bits} bits` : 'Not reported'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span>{k}</span>
                      <span className="mono">{v}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() =>
                    api
                      .invoke('saveText', { name: 'certificate.pem', text: cert.pem })
                      .catch((e) => notify(e.message))
                  }
                >
                  <Download size={15} />
                  Export public certificate
                </button>
              </section>
            )}
          </div>
          <div className="inline-note">
            This is a single negotiated connection and certificate-chain inspection. It does not
            enumerate all supported protocols/ciphers or prove the absence of TLS vulnerabilities.
          </div>
        </>
      ) : (
        !busy && (
          <Empty icon={<LockKeyhole size={32} />} title="Look beyond the padlock">
            Enter an HTTPS endpoint to inspect its certificate chain, negotiated protocol, cipher,
            identity, and trust result.
          </Empty>
        )
      )}
    </div>
  );
}
export function HeaderInspector({
  records,
  selected,
  select,
  action,
}: {
  records: TrafficRecord[];
  selected?: TrafficRecord;
  select: (s: string) => void;
  action: RecordAction;
}) {
  const [findings, setFindings] = useState<Finding[]>([]),
    [filter, setFilter] = useState('All findings'),
    [error, setError] = useState('');
  const available = records.filter((r) => r.status && /^https?:/.test(r.url));
  const record = selected?.status ? selected : available.at(-1);
  useEffect(() => {
    let active = true;
    setError('');
    if (record)
      api
        .invoke<Finding[]>('inspectHeaders', record.id)
        .then((f) => {
          if (active) setFindings(f);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [record?.id, record?.responseHeaders]);
  const review = findings.filter((f) => ['review', 'warning'].includes(f.level)).length;
  return (
    <div className="tool-page">
      <SectionHead
        eyebrow="POLICY · EVIDENCE · IMPROVEMENT"
        title="Header Hardening"
        description="Review browser protections against the response actually received."
      />
      {!record ? (
        <Empty icon={<Shield size={32} />} title="Make headers tell their story">
          Select a captured response to inspect CSP, CORS, nosniff, HSTS, cookies, and other browser
          security policies.
        </Empty>
      ) : (
        <>
          <div className="header-selector">
            <Method value={record.method} />
            <select
              aria-label="Response to analyze"
              value={record.id}
              onChange={(e) => select(e.target.value)}
            >
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.number} · {r.url}
                </option>
              ))}
            </select>
            <StatusCode value={record.status} />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div className="analysis-summary">
            <Shield size={26} />
            <div>
              <h2>
                {review
                  ? `${review} ${review === 1 ? 'item' : 'items'} to review`
                  : 'Review complete'}
              </h2>
              <p>
                {findings.filter((f) => f.level === 'pass').length} header-presence checks passed ·{' '}
                {findings.length} observations
              </p>
            </div>
            <Tabs
              items={['All findings', 'Needs review', 'Present']}
              value={filter}
              onChange={setFilter}
            />
          </div>
          <div className="findings-list">
            {findings
              .filter(
                (f) =>
                  filter === 'All findings' ||
                  (filter === 'Needs review'
                    ? ['review', 'warning'].includes(f.level)
                    : f.level === 'pass'),
              )
              .map((f, i) => (
                <article className="finding" key={i}>
                  <div className={`finding-icon ${f.level}`}>
                    {f.level === 'pass' ? (
                      <CheckCircle2 size={19} />
                    ) : f.level === 'warning' ? (
                      <ShieldAlert size={19} />
                    ) : (
                      <Shield size={19} />
                    )}
                  </div>
                  <div>
                    <div className="finding-title">
                      <h3>{f.title}</h3>
                      <Pill
                        tone={
                          f.level === 'pass' ? 'green' : f.level === 'warning' ? 'red' : 'amber'
                        }
                      >
                        {f.level === 'pass' ? 'Present' : f.level === 'review' ? 'Review' : f.level}
                      </Pill>
                      {f.plugin && <Pill>{f.plugin}</Pill>}
                    </div>
                    <code>{f.header}</code>
                    <div className="evidence">{f.evidence}</div>
                    <p>{f.advice}</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      action('rule', record, {
                        phase: 'response',
                        header: f.header,
                        value: f.header === 'x-content-type-options' ? 'nosniff' : '',
                      })
                    }
                  >
                    Create rule
                    <ArrowRight size={14} />
                  </button>
                </article>
              ))}
          </div>
          <div className="inline-note">
            Advisory checks, not an exploit verdict. Applicability depends on content type,
            application behavior, and intended cross-origin access. Header presence does not
            validate the complete policy.
          </div>
        </>
      )}
    </div>
  );
}
