# THUGSred Glasses

A desktop workspace for web security research and development. Electron + React + TypeScript UI, independently testable Node.js proxy core, local extension system. Version **0.1.0**. Official home: [glasses.thugs.red](https://glasses.thugs.red). The website is maintained separately; [Community browsing and signed installation](COMMUNITY.md) use its public API.

## Illustrated guides

- [User and developer manual - 22 pages](../output/pdf/Glasses-0.1-User-Manual.pdf)
- [Product overview - 4 pages](../output/pdf/Glasses-Product-Overview.pdf)

Both use actual application screenshots and the Affinity artwork. The manual covers operation, corporate networking, privacy, CA trust, extensions, security, packaging and troubleshooting. The overview is intended for sharing. `scripts/manuals.py` rebuilds them with ReportLab after the desktop smoke has generated screenshots.

## Run locally

Use Node.js 24 LTS and npm. Node 23 was available for the initial development run; CI uses Node 24.

```sh
npm ci
npm run dev
```

Or run the production build:

```sh
npm run native           # macOS helper; no-op on other platforms
npm run build
npm start
```

Select **Local lab** to create real traffic against a test server running on your own machine. Select a row to inspect it, or right-click to send it to another tool. **Open browser** starts an isolated Chromium session configured to use Glasses. The lab is explicitly sample traffic; ordinary startup does not seed fake captures.

## Included

- HTTP/1.1 and HTTPS MITM proxy, with a unique per-install CA and verified upstream TLS.
- Ordered upstream chains of up to eight HTTP, HTTPS or SOCKS5 proxies; Basic/SOCKS authentication with OS-encrypted relay passwords; fail-closed routing.
- macOS system proxy toggle with saved settings, rollback and crash-recovery journal.
- Privacy bypass by hostname, wildcard, IP or CIDR; excluded traffic has no MITM or capture.
- Import an organization RSA signing CA and issuer chain, or return to the local CA.
- SOCKS5 TCP CONNECT tunnel forwarding with metadata capture.
- Request/response headers, decoded text, binary/hex previews, raw views, filtering, host selection, and resizable inspection panes.
- Request and response interception: edit, forward, drop, URL filter, bounded pending queue, deadlines.
- Repeater: method/URL/header/body editing, UTF-8 or binary payloads, iterations, payload substitution, concurrency, delay, cancellation and per-result inspection.
- Site Timeline: observed request waterfall, duration comparison, connection/TLS/wait/download timings and transfer totals.
- SSL/TLS Inspector: upstream certificate chain, identity, validity, fingerprint, protocol, cipher, ALPN and trust result.
- Header Hardening: advisory CSP, CORS, HSTS, nosniff, framing, referrer/permissions/isolation headers, cookie flags and disclosure checks.
- Header rewrite rules and visible applied-rule provenance.
- View-specific context menus, cross-tool transfers, UTF-8 URL/Base64/hex/HTML/JSON transformations with previews.
- Dedicated Settings pane, OS-following light/dark modes, four accent palettes, density, ports, scope, timeouts, capture limits and export paths.
- Native session and HAR import/export; body and public certificate export.
- Local plugins: header rules/checks, complete sidebar tools with HTML/CSS/JavaScript, and context-menu contributions. See the [plugin SDK](../plugin-sdk/README.md).

## Everyday workflows

1. Click **Start proxy** or **Open browser**. The HTTP/HTTPS listener defaults to `127.0.0.1:8080`; SOCKS5 defaults to `127.0.0.1:1080`. Change occupied ports in Settings.
2. Visit your target in the research browser. Its storage is separate from your personal browser and it has no application IPC bridge.
3. Select a request. Inspect headers or body; right-click a selected value to transform it or transfer its request to Repeater.
4. Use **Settings → Proxy & interception** to choose request, response, or both and an optional URL fragment. Turn on Intercept in the toolbar. Paused messages appear in Intercept.
5. In Repeater, use `{{payload}}` and `{{iteration}}` in the URL, header values or body. Each run is bounded to 1,000 requests and concurrency 10. Payloads cycle; the iteration index starts at 1. The delay applies per worker. Encode URL payloads explicitly.
6. Save a Glasses session for later or export a HAR using the traffic export menu. Captures are in memory until explicitly saved.

Interception applies to incoming proxy traffic. Repeater sends directly through the same recording/rules engine and does not enter the interactive interception queue, so experiments cannot deadlock on their own UI.

### External clients and CA trust

Export the public CA from **Settings → Certificates**. Use it explicitly with a client:

```sh
curl --proxy http://127.0.0.1:8080 \
  --cacert /path/to/glasses-ca.pem \
  https://example.com
```

Alternatively import it into a dedicated research browser's trust store. OS certificate trust is never changed by Glasses. The macOS **Toggle proxy** button explicitly changes network proxy settings and restores the saved configuration when switched off, stopped, or quit. The built-in research browser narrowly trusts certificates signed by the active signing CA, with hostname and validity checks. The proxy verifies upstream certificates; the TLS Inspector separately reports trust failures instead of silently accepting them for proxied traffic.

SOCKS-aware clients can use `socks5h://127.0.0.1:1080`. SOCKS traffic is a TCP tunnel; HTTP inside that tunnel is not decrypted by the HTTP inspector.

## Corporate routing and privacy

In **Settings → Proxy & interception → Proxy / SOCKS relaying**, add hops in connection order, enter host/port and any credentials, enable relaying and save. **Test saved route** opens a TCP connection and, for HTTPS, validates TLS without fetching a page. HTTP destinations use absolute-form forwarding at the last HTTP(S) hop; HTTPS and intermediate hops use CONNECT. SOCKS5 forwards target hostnames for remote resolution. No direct fallback is permitted after a relay failure.

HTTP Basic and SOCKS5 username/password are supported. NTLM, Kerberos, PAC execution, SOCKS4 and UDP are not. HTTPS proxy transport encrypts the client-to-proxy link; HTTP Basic and SOCKS5 credentials otherwise travel without transport encryption. Stored relay passwords are encrypted with Electron safeStorage and never returned in settings. Linux's insecure basic_text backend is refused.

**Show current macOS proxies** reads existing service endpoints so you can configure the corporate relay. It does not copy credentials or execute PAC scripts. Toggle proxy refuses to replace a detected existing proxy/PAC configuration until a relay is configured. It updates enabled services in the current network location, preserves the full original proxy dictionary and protocol state, and checks for external edits before restoring. New services/locations added later need a new toggle cycle. Applications that ignore system settings or have explicit proxies are unaffected. This is not a VPN.

Toggling off switches open research browser sessions back to system routing and closes their pooled connections; reload the page to open a fresh connection. The listener remains available to manually configured clients. On a fresh launch, **Open browser** uses Glasses explicitly. A recovery journal is written before system changes. Normal stop/quit restores settings; on an unclean exit restoration is attempted next launch. If another program has changed settings, Glasses preserves externally changed endpoints and releases the settings it still owns. A recovery report is saved, and the conflict does not prevent shutdown. If an actual OS authorization/write error prevents recovery, Quit anyway remains available and keeps the journal for the next launch.

**Privacy bypass list** accepts one literal hostname, `*.subdomain.example`, IP, or IPv4/IPv6 CIDR per line (up to 500). Blank/comment lines are ignored. A wildcard matches subdomains only. CIDRs also check locally resolved addresses; unresolved CIDR checks withhold the connection. DNS is local for this check even when the relay would normally resolve the destination remotely. Lists cannot infer remote split-DNS addresses: include literal confidential hostnames for those environments. The bypass policy suppresses interception, rewrite rules, plugin visibility and capture; HTTPS CONNECT becomes an opaque tunnel. Traffic still follows the configured corporate chain. Repeater and TLS Inspector refuse excluded destinations. Changes close active tunnels and cancel pending work. Earlier captures/exports are not erased automatically.

Under **Settings → Certificates**, stop the proxy and import a PEM signing CA (optionally followed by its issuer chain) and matching private key. RSA keys of at least 2048 bits are supported in 0.1; ECDSA signing CAs and hardware-backed keys are deferred. Encrypted PEM keys can be unlocked with a passphrase that is not retained. Glasses validates CA/signing usage, dates, key match and supplied issuer signatures; generated leaf validity is capped by the signing CA. Imported private keys are stored with private file permissions, not encrypted at rest. Public certificate export excludes keys. The original local CA remains available through **Use local CA**.

## Build packages

For the Mac-controlled release workflow, see [BUILDING.md](BUILDING.md).

```sh
npm run check             # TypeScript, production UI, core integration tests
npm run test:ui           # Real Electron desktop smoke + extension isolation checks
npm run test:packaged     # Hardened local macOS ARM64 package smoke, after packaging
npm run security:check    # Build, tests and dependency audit
npm run dist:mac:local    # Apple Silicon DMG
npm run dist:mac          # arm64 + x64 DMG and ZIP
npm run dist:linux        # arm64 + x64 tar.gz and Debian packages
npm run dist:win          # arm64 + x64 NSIS EXE
```

Artifacts appear in `release/`. The central release script builds macOS locally, Windows in a local Docker/Wine worker, and Linux in a disposable Docker worker locally or over SSH. CI packaging is an optional manual workflow. See [release notes](RELEASE_NOTES.md) for what was actually verified locally.

Release signing uses electron-builder's environment-based certificate configuration. Public macOS distribution needs a Developer ID certificate and notarization credentials; Windows signing needs an appropriate code-signing identity. Initial local packages are development artifacts, not notarized production releases. No signing keys are stored in the repository.

Editable logo and icon masters are in [docs/brand](brand/README.md), saved with Affinity Designer 2. The final SVG export uses vector curves for the binary lettering and soft vector reflection layers. Icons are checked in. To regenerate the UI mark, PNG, multi-resolution ICO and, on macOS, ICNS:

```sh
npm run icons
```

## Project map

| Path                          | Responsibility                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `core/`                       | HTTP/TLS/SOCKS, interception, replay jobs, rules, plugins, formats, inspectors            |
| `electron/`                   | Native windows/dialogs, constrained IPC, isolated research browser and extension protocol |
| `src/`                        | React desktop workspace, themes, settings and tool interfaces                             |
| `plugin-sdk/`                 | Manifest contract, public bridge, examples                                                |
| `tests/`                      | Local-network integration tests                                                           |
| `scripts/smoke.mjs`           | Real Electron UI and sandbox verification                                                 |
| `docs/design/`                | Approved visual concepts and generated-image prompts                                      |
| `docs/IMPLEMENTATION_PLAN.md` | Scope and architecture decisions                                                          |

## Boundaries for 0.1

HTTP/2, HTTP/3/QUIC, gRPC semantics and SOCKS UDP are not implemented. WebSocket upgrades are tunneled and recorded, but individual frames are not displayed or edited. A separate HTTPS probe reports a single negotiated TLS connection; it is not a comprehensive cipher vulnerability scanner.

Request bodies exceeding the configured limit are rejected. Larger responses continue streaming while only the configured prefix is captured; they cannot be paused for whole-body edits. Session history is capped by entry count and approximately 128 MiB of stored base64 bodies. In-flight transfers and renderer overhead are additional memory. Timings are proxy observations, not browser rendering metrics. HAR import normalizes some metadata and does not restore original per-phase timings.

Header findings are context-dependent advice, not proof of exploitability. Local extension publishers are self-declared. Community catalog browsing, signed package verification and reviewed updates are implemented; live service acceptance is tracked separately. Automatic updates are deferred. Plugins receive no direct Node, filesystem, network or unrestricted IPC access.

This is a usable first release for iteration and testing. Further protocol coverage, performance profiling, independent security review, signed distribution and enterprise deployment controls remain before describing it as an enterprise-hardened product.
