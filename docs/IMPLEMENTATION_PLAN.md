# Glasses 0.1 — implementation plan

Approved visual direction: `design/glasses-dark-concept-v3.png`. Brand text is always **THUGS** in the theme foreground and **red** in red. Bold red Wayfarer-style sunglasses with dark lenses and semi-transparent binary detail, shared by the sidebar and app icon (subsequent user correction). Theme accent changes must not recolor the brand.

## Delivery order

1. Desktop foundation: Electron, React, TypeScript, isolated renderer, local application state, theme tokens, dedicated Settings pane, accessible shared context menus.
2. Proxy engine: local HTTP/HTTPS MITM listener, per-install CA, certificate export, SOCKS5 CONNECT, traffic filtering, body/header inspection, sessions and HAR export/import, request/response interception and rewrite rules.
3. Research tools: Repeater and bounded iterative/payload runs; observed request waterfall/timing; upstream TLS certificate/protocol inspector; evidence-based header checks.
4. Extension foundation: versioned manifest, local plugin installation and removal, declared capabilities, restricted runtime, example plugin and SDK docs. Community storefront is an explicitly unavailable backend until a later release.
5. Verification: local HTTP/HTTPS targets, interception and mutation, replay/fuzz cancellation, timing and header checks, SOCKS, plugin behavior, renderer smoke tests, native macOS build. CI builds native packages on macOS/Windows/Linux for x64 and arm64.

## Main workspace

Tools: Traffic, Intercept, Repeater, Timeline, TLS Inspector, Header Hardening, Rules, Plugins, Community. Targets in the sidebar. Live operational controls and status belong in the workspace. Application configuration belongs in Settings, opened from the title bar or Cmd/Ctrl+,.

Settings categories: General; Appearance (System/Light/Dark and palettes, density); Proxy & interception (ports, limits and timeouts); Certificates; Files & storage (session/export paths, retention); Plugins & community; Integrations; About. No theme controls in the sidebar footer.

## First-release behavior

- Capture HTTP and HTTPS requests and responses, including binary bodies with an explicit size/truncation indicator. Never execute captured HTML or scripts in the application renderer.
- Local HTTPS CA and generated leaf certificates; certificate export and trust instructions. Do not silently change OS trust or system proxy settings. An isolated research browser uses the proxy and narrowly trusts only the generated local CA.
- SOCKS5 TCP CONNECT forwarding. Distinguish tunnel records from decrypted HTTP traffic; UDP is a later capability.
- Intercept before sending requests or delivering responses; edit URL/method/headers/body, forward or drop, bounded queue/timeout, release or drop queued work on shutdown.
- Repeater supports manual sends, iteration count, payload list with `{{payload}}` and `{{iteration}}` placeholders, delay, bounded concurrency, cancellation, individual result inspection, and transfer to other tools. No automatically discovered targets or background scanning.
- Timeline groups captured requests by host and shows observed connection/TLS/TTFB/download phases. Proxy-observed timing is not browser rendering time or a Lighthouse score. Reused/unavailable phases are explicitly shown as unavailable.
- TLS Inspector connects to the upstream endpoint to show negotiated version/cipher, certificate identity, SANs, dates, chain, fingerprint, ALPN and trust errors. Keep these distinct from proxy-generated certificates; this is not an exhaustive cipher-suite vulnerability scanner.
- Header Hardening checks actual response headers with applicability, evidence, explanation and suggestions: CSP, CORS, nosniff, HSTS, frame protection, referrer policy, permissions policy, isolation headers, cookie flags and information disclosure. Findings are advisory; missing headers alone do not prove exploitable vulnerabilities.
- Rewrite rules have enabled state, request/response phase, host/path matching, header set/remove operations. Mutations visibly identify applied rules/plugins.
- Persistence and session import/export are deliberate: traffic may contain credentials. Prefer explicit session saves, private local storage and atomic settings writes. Do not publish traffic to the future community service.

## Context menus

Shared action registry with view-specific availability and keyboard access (context-menu key/Shift+F10). Commands have matching toolbar alternatives.

| Context                   | Actions                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Traffic row               | Send to Repeater; intercept matching request; timeline; TLS; header checks; copy URL/cURL; export          |
| Request header            | Copy; edit/remove in Repeater; encode/decode selected value; create request rule                           |
| Request body in an editor | Copy/cut/paste; transform selection with preview; replace selection; mark fuzz placeholder                 |
| Response header           | Copy name/value; explain/check header; create response rule; inspect TLS                                   |
| Response text/JSON        | Copy; prettify/minify JSON; URL/Base64/hex/HTML/JSON transformations; save body; replay associated request |
| Response binary           | Hex/Base64 representation; copy representation; save original bytes                                        |
| TLS/certificate           | Copy fingerprint/subject/SANs; export certificate; open associated traffic                                 |
| Timeline/result           | Inspect request; replay; inspect TLS/headers; copy timings                                                 |

Transforms are explicit and reversible. Encoding operates on UTF-8 bytes; decoding errors are visible. Captured originals remain unchanged. Invalid actions are disabled or omitted, not falsely successful.

## Architecture and release boundaries

- Electron renderer: sandboxed, context isolation, no Node APIs, strict CSP, constrained preload IPC and validated payloads. Research browsing is a separate session without application IPC. See [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- Node core: separately testable proxy, TLS, rules, stores, inspector and replay services. Versioned serializable messages between core and UI. Bound memory, network timeouts and job sizes.
- Plugin API starts small and explicit; no untrusted extension code in the application renderer or main process. Permission declarations are enforced, not just displayed. Community backend, payments, accounts and signing distribution arrive later.
- Package via electron-builder: macOS DMG/ZIP, Linux tar.gz/DEB, Windows NSIS EXE. Build and test native targets in CI. Apple signing/notarization and Windows signing depend on owner-provided release credentials. See [macOS](https://www.electron.build/mac/), [Linux](https://www.electron.build/linux/) and [Windows](https://www.electron.build/win/) configuration.
- First-release protocol boundary: HTTP/1.1 inspection; HTTP/2 upstream negotiation, HTTP/3/QUIC, gRPC semantic inspection and SOCKS UDP are follow-up work. Do not advertise unsupported protocol fidelity.
- A usable 0.1 is the starting point for enterprise hardening, not an audited security certification. Release notes must name tested platforms and known limitations honestly.

## Acceptance

A user can launch the native macOS app, start a local listener, capture real traffic from a local test target, inspect and edit/replay it, run bounded payload iterations, inspect timing/TLS/headers, install a local example extension, save/reopen a session, change themes from Settings, and build a native installer. Automated tests and an actual desktop smoke run verify these paths. Cross-platform artifacts are called verified only after their platform jobs pass.

## Accepted additions - networking and documentation

- Implement a shared outbound transport for HTTP/HTTPS/SOCKS5 chains, credentials and route testing across all network tools. No direct fallback on relay failures.
- Add privacy bypass before capture or TLS interception; preserve mandatory corporate routing.
- Add validated organization CA import and local CA restoration.
- Add a macOS native system proxy adapter with recoverable, compare-before-write configuration. Keep Windows/Linux manual routing in this release.
- Produce an illustrated user/developer manual and a short promotional PDF from the running application; distinguish implemented capabilities from deferred services.
- Use https://glasses.thugs.red in About and documentation; build the website in a separate chat.
