const tls = require('node:tls');
const net = require('node:net');
function headersObject(headers) {
  const out = Object.create(null);
  for (const [k, v] of Object.entries(headers || {}))
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  return out;
}
function inspectHeaders(record) {
  const h = headersObject(record.responseHeaders),
    findings = [];
  const html = /text\/html|application\/xhtml/i.test(h['content-type'] || '');
  const add = (header, level, title, evidence, advice) =>
    findings.push({ header, level, title, evidence, advice });
  const check = (name, title, advice, applicable = true) => {
    if (!applicable) return;
    add(name, h[name] ? 'pass' : 'review', title, h[name] || 'Header absent', advice);
  };
  check(
    'x-content-type-options',
    'MIME sniffing protection',
    'Use X-Content-Type-Options: nosniff.',
  );
  if (h['x-content-type-options'] && h['x-content-type-options'].toLowerCase() !== 'nosniff')
    add(
      'x-content-type-options',
      'warning',
      'Unrecognized nosniff value',
      h['x-content-type-options'],
      'The supported value is nosniff.',
    );
  check(
    'strict-transport-security',
    'HTTPS enforcement',
    'After validating HTTPS deployment, set a suitable max-age; assess subdomains before including them.',
    record.url.startsWith('https:'),
  );
  if (/max-age\s*=\s*0(?:\D|$)/i.test(h['strict-transport-security'] || ''))
    add(
      'strict-transport-security',
      'warning',
      'HSTS is disabled',
      h['strict-transport-security'],
      'max-age=0 removes HSTS policy.',
    );
  check(
    'content-security-policy',
    'Content Security Policy',
    'Start with a tailored report-only policy, then enforce a tested nonce/hash based policy.',
    html,
  );
  if (
    h['content-security-policy'] &&
    /'unsafe-inline'|'unsafe-eval'|(?:^|[;\s])\*(?:[;\s]|$)/.test(h['content-security-policy'])
  )
    add(
      'content-security-policy',
      'review',
      'Broad CSP sources',
      h['content-security-policy'],
      'Assess script directives, nonce/hash use and compatibility. This is a heuristic, not a full CSP parser.',
    );
  check(
    'x-frame-options',
    'Framing protection',
    'Use CSP frame-ancestors, or a suitable X-Frame-Options policy.',
    html && !/frame-ancestors/i.test(h['content-security-policy'] || ''),
  );
  check(
    'referrer-policy',
    'Referrer disclosure',
    'Choose a policy such as strict-origin-when-cross-origin.',
    html,
  );
  check(
    'permissions-policy',
    'Browser feature permissions',
    'Disable browser capabilities this site does not use.',
    html,
  );
  for (const name of [
    'cross-origin-opener-policy',
    'cross-origin-resource-policy',
    'cross-origin-embedder-policy',
  ])
    check(
      name,
      name.replaceAll('-', ' '),
      'Review isolation requirements and compatibility before enabling.',
      html,
    );
  const origin = h['access-control-allow-origin'];
  if (origin)
    add(
      'access-control-allow-origin',
      origin === '*' ? 'review' : 'info',
      'Cross-origin access',
      origin,
      'Check intended origins and resource sensitivity. Public APIs may intentionally allow all origins.',
    );
  if (origin === '*' && h['access-control-allow-credentials'] === 'true')
    add(
      'access-control-allow-credentials',
      'warning',
      'Incompatible credentialed CORS policy',
      '* with credentials=true',
      'Browsers reject credentialed reads with wildcard origin; use a validated explicit origin.',
    );
  if (h.server || h['x-powered-by'])
    add(
      'server',
      'info',
      'Technology disclosure',
      [h.server, h['x-powered-by']].filter(Boolean).join(' · '),
      'Consider reducing version disclosure; this alone is not a vulnerability.',
    );
  const cookies = record.responseHeaders?.['set-cookie'];
  for (const cookie of cookies ? (Array.isArray(cookies) ? cookies : [cookies]) : []) {
    const name = cookie.split('=')[0];
    const absent = ['Secure', 'HttpOnly', 'SameSite'].filter(
      (flag) => !new RegExp('(?:^|;)\\s*' + flag + '(?:=|;|$)', 'i').test(cookie),
    );
    add(
      'set-cookie',
      absent.length ? 'review' : 'pass',
      `Cookie: ${name}`,
      absent.length ? `Missing ${absent.join(', ')}` : 'Secure, HttpOnly, SameSite present',
      'Choose flags according to cookie purpose; JavaScript-readable cookies cannot use HttpOnly.',
    );
  }
  return findings;
}
async function inspectTLS(input, timeout = 10000, router) {
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Enter an HTTPS endpoint without credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const start = performance.now();
  const tunnel = router ? await router.connect(host, Number(url.port) || 443) : undefined;
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      socket: tunnel,
      ca: router?.trust(),
      host,
      port: Number(url.port) || 443,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false,
      ALPNProtocols: ['h2', 'http/1.1'],
    });
    socket.setTimeout(timeout, () => socket.destroy(new Error('TLS connection timed out')));
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      const chain = [];
      const seen = new Set();
      let cert = socket.getPeerCertificate(true);
      while (cert && cert.raw && !seen.has(cert.fingerprint256) && chain.length < 12) {
        seen.add(cert.fingerprint256);
        chain.push({
          subject: cert.subject,
          issuer: cert.issuer,
          san: cert.subjectaltname,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          fingerprint: cert.fingerprint256,
          serialNumber: cert.serialNumber,
          bits: cert.bits,
          pem: `-----BEGIN CERTIFICATE-----\n${cert.raw
            .toString('base64')
            .match(/.{1,64}/g)
            .join('\n')}\n-----END CERTIFICATE-----\n`,
        });
        cert = cert.issuerCertificate;
      }
      resolve({
        host,
        port: Number(url.port) || 443,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher(),
        alpn: socket.alpnProtocol || 'Not negotiated',
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        handshakeMs: Math.round(performance.now() - start),
        chain,
        checkedAt: new Date().toISOString(),
      });
      socket.end();
    });
  });
}
module.exports = { inspectHeaders, inspectTLS, headersObject };
