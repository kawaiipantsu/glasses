# Security in Glasses 0.1

Glasses handles hostile web content by design. Captured requests/responses, headers, URLs, session files and plugins are untrusted input. Research capabilities must remain useful while that data stays outside application authority.

## Trust boundaries

1. **Proxy core:** intentionally connects to researcher-selected HTTP/HTTPS endpoints, including local and private networks. It parses traffic but never evaluates response code, launches payloads through a shell, or writes server-supplied filenames automatically.
2. **Application renderer:** local bundled UI, no Node integration, Chromium sandbox, context isolation, restrictive CSP. Captured HTML/SVG/JavaScript appears as escaped text. No active remote-content preview is embedded in the application DOM.
3. **Main-process IPC:** one explicit action dispatcher, payload schemas at privileged boundaries, exact window/top-frame/origin validation. No generic shell, arbitrary filesystem reader, arbitrary IPC channel forwarding or arbitrary `openExternal` bridge. The About link opens one fixed HTTPS URL.
4. **Research browser:** separate ephemeral session, no application preload/IPC, sandbox and web security enabled, new windows denied, permissions denied by default. Normal site JavaScript can execute here without acquiring application privileges. Its proxy CA trust is restricted to the active signing CA, valid dates and matching hostnames.
5. **Extension UI:** separate opaque-origin sandboxed frames, restrictive response CSP, denied direct network/filesystem/Node/OS access, source-checked messages and capability-filtered context. A plugin may request selected traffic or contribute its own tool/menu; it cannot silently acquire all application privileges. Repeater handoffs prepare a draft rather than send a request.

## Controls implemented

| Risk                                  | Current control                                                                                                                                         | Verification                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Response/header HTML injection        | React text rendering; no captured HTML insertion; no executable response preview                                                                        | Desktop test includes script, image handler, SVG handler, iframe and javascript URL payloads |
| Renderer-to-main escalation           | No Node APIs in renderer; sandbox/context isolation; exact IPC sender window/frame/origin; validated action payloads                                    | IPC trust tests and extension bridge isolation checks                                        |
| Extension privilege escalation        | Required capability declarations, active-frame source checks, host-side draft validation, no app bridge in frames                                       | Manifest rejection tests, live extension origin/storage/network/Node denial checks           |
| Protocol/URL abuse                    | App custom protocol restricts host and local asset root; external navigation/windows denied; UI session denies remote requests                          | UI isolation tests and handler review                                                        |
| Header/request injection              | Typed input schemas; CR/LF/NUL rejection in constructed headers; null-prototype header dictionaries                                                     | Unsafe input and hostile property-name tests                                                 |
| Decompression bombs / UI exhaustion   | Async decompression with 16 MiB output budget and concurrency 4; bounded capture; limited highlighted text/hex previews                                 | Bomb/malformed compression tests; oversized response streaming tests                         |
| Recursive self-proxy loops            | Reject the proxy's own listener as upstream, including resolved loopback addresses                                                                      | Self-proxy test plus legitimate local target test                                            |
| Stalled interception / fuzz jobs      | Bounded queues, request/interception deadlines, iteration/concurrency limits, cancellation wakes all delayed workers                                    | Drop, cancellation and concurrent-delay tests                                                |
| Secret disclosure through diagnostics | Rotating local operational metadata logs; no URLs, headers, bodies, raw errors or CA keys in those logs                                                 | Log-field and file-permission test                                                           |
| Private local state                   | Per-install CA; private key/file modes; atomic settings writes with unique exclusive temp files; captures saved only on explicit export                 | Filesystem checks and code review                                                            |
| Supply-chain drift                    | npm lockfile; pinned Electron version; scoped patched build dependency overrides; pinned CI action commits; npm audit / CodeQL workflow                 | Local npm audit and tests; initial GitHub CodeQL and dependency workflows passed             |
| Packaged runtime abuse                | Disable RunAsNode, NODE_OPTIONS/NODE_EXTRA_CA_CERTS and Node inspect flags; require ASAR; enable ASAR integrity; disable extra file-protocol privileges | Fuse inspection and packaged startup/interaction check                                       |

The application does **not** sanitize or rewrite the captured evidence to make it look safe. It encodes content at the display boundary. Raw captured bytes remain exportable within the configured capture budget. It does not block ordinary local/private research targets. Limits protect the application and are documented; protocol-specific fidelity remains explicit.

## Release hardening

Release fuses are applied only to packaged builds. Development continues to support debugging and the local Vite server. Packaged builds ignore the development-server environment flag. Main-process debugging is disabled in packages; the normal Electron development binary is used for full Playwright automation, and the packaged app is checked separately through its UI.

ASAR integrity is supported by Electron on macOS and Windows; Linux does not gain equivalent enforcement merely by setting the fuse. The protection also depends on authenticated distribution and OS code signing. The initial local artifacts are not Developer ID signed/notarized. Cookie encryption for persisted browser profiles is deferred: research sessions are ephemeral and macOS keychain integration should be introduced with signed distribution.

The public CA can be exported. Its private key is never exposed over IPC. OS trust is not modified. macOS network proxies change only through the explicit toggle, with a private recovery journal, exact-state comparison, rollback and restore-on-stop/quit. The native SystemConfiguration helper accepts bounded JSON, invokes no shell and uses macOS authorization. Its read path and restoration of a real leftover Glasses configuration have been exercised. Automated profiles cannot change system routing; fresh takeover needs an interactive acceptance check. Upstream TLS verification stays enabled; inspecting a bad certificate is a separate observation workflow.

## Routing and certificate controls

Relay credentials are separated from public settings and encrypted using Electron safeStorage; insecure Linux basic_text storage is refused. Each hop receives only its own credentials. HTTPS relay and destination certificates are validated against bundled/system roots plus the active research CA. Relay failure never silently switches to direct networking. Handshakes have deadlines and bounded buffers.

Privacy bypass runs before record creation and HTTPS termination; excluded tunnels are never made available to plugins. Hostnames, wildcard boundaries and IPv4/IPv6 CIDRs are validated. CIDR decisions use local DNS and do not represent remote split DNS; exact sensitive hostnames should be listed. Changing routing disconnects existing tunnels and cancels pending work. Previously captured or exported data remains the researcher's responsibility.

Custom signing CA imports check key correspondence, CA/key-signing constraints, validity and supplied chain signatures. This version supports RSA >=2048 bits. Public metadata/export never includes keys. Imported CA keys are decrypted into private local storage (mode 0600), so disk encryption and OS account protection remain relevant. Relay passwords use OS encryption separately. EC/hardware signing and encrypted CA-key storage are future improvements.

The recovery journal preserves full proxy dictionaries and uses atomic file replacement. It is sensitive local state. A native preferences lock plus expected-state comparison prevents overwriting concurrent network changes. A hard crash cannot restore settings until the app starts again; externally changed settings are preserved while still-owned Glasses settings are released. Conflicts do not trap the app open. Actual restore failures retain the journal and offer an explicit Quit anyway option. Automated test profiles cannot modify system routing and use separate ephemeral listener ports. OS authorization and real takeover still require an interactive acceptance check on a test Mac.

Primary references: [Apple SCPreferences](https://developer.apple.com/documentation/systemconfiguration/scpreferences-ft8), [SOCKS5 RFC 1928](https://datatracker.ietf.org/doc/html/rfc1928), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Practical limits and follow-up work

- Chromium/Electron and Node vulnerabilities remain relevant even with these controls. Ship timely runtime updates and rerun regression tests.
- External independent review, fuzzing of protocol parsers/importers, long-running resource profiling and dedicated plugin process CPU/memory controls remain follow-up work. A malicious plugin may still consume resources or present misleading UI.
- Session parsing is size-bounded, but large JSON operations and initial CA setup are not yet isolated into workers. Local settings writes are small and synchronous.
- Loopback binding is not local-user authentication. Other programs running on the same machine may use the listener while it is enabled. Remote/LAN proxy binding and authentication are not part of 0.1.
- The proxy uses Node's structured HTTP parser. It is not a raw TCP request-smuggling laboratory and does not promise malformed-wire preservation.
- Captures/exports may contain credentials. File permissions are not encrypted storage. Redacted export and encrypted project vaults are future options.
- Local plugin authors are self-declared. Community signatures authenticate distribution through the pinned service key, not author identity or code safety. Automatic updates, runtime revocation, and privileged integration brokers are not implemented.
- Code signing, notarization, a verified update channel and enterprise management are release work, not claims made by this local prototype.

## Guidance reviewed

The two requested guides were used as review prompts: [Snyk's Node.js security practices](https://snyk.io/articles/nodejs-security-best-practice/) and [Safeguard's Electron security guide](https://safeguard.sh/resources/blog/electron-app-security-best-practices). Framework behavior and implementation choices were checked against primary documentation: [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), and [ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity).

Generic server advice is adapted to this application: account MFA does not apply to the offline desktop core; broad payload sanitization would damage research evidence; no update feed is added until authenticated distribution exists. The runtime's actual behavior and our tests take precedence over generalized claims in third-party articles.

## Reporting an issue

Use an established private THUGSred contact channel for exploitable findings; a dedicated security-reporting endpoint has not yet been configured. Include version, platform, minimal local reproduction and expected/actual behavior. Avoid posting real captured credentials or private CA keys in a public issue.

## Community distribution boundary

Online connections require opt-in. The renderer cannot request arbitrary URLs: main builds fixed HTTPS endpoints from validated IDs/versions. It verifies pinned Ed25519 signatures, exact payload bytes, short-lived authorization, identity, capability set, byte length and SHA-256, then applies the plugin validator. Redirects and research-CA trust are refused. Deep links queue a review request without installing code. One-use review tickets remain in main memory; activation requires an explicit install action. Updates cannot replace local-source IDs or downgrade versions, and installation checks that the previous state still matches the review. Failed persistence rolls back in-memory state. See [Community trust details](docs/COMMUNITY.md).
