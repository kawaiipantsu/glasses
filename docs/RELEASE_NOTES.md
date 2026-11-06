# Glasses 0.1.0

First local development release, 6 November 2026.

The implementation follows the approved charcoal/red design with a dedicated Settings pane, two-color THUGSred wordmark, workflow-specific context menus and a community extension foundation. The final branding is a layered Affinity Designer 2 vector: bold red sunglasses, dark lenses, semi-transparent binary, polished depth and softly feathered reflections. The UI and platform icons use the same exported artwork.

## Verification

- Node integration/security suite: **47 passing tests**, covering actual local HTTP and HTTPS, CONNECT MITM, request/response interception and mutation, drop handling, oversized response streaming, decompression/HAR, rewrite/plugin behavior, replay payload iteration/cancellation, fragmented SOCKS5 negotiation, upstream TLS inspection, header findings, IPC caller validation, hostile property names, decompression bombs and private metadata logs.
- Desktop smoke: launched Electron on macOS arm64, loaded real local lab traffic, inspected bodies, opened response context menus and transformation previews, changed light/dark settings, replayed and fuzzed requests, visited Timeline/Header Hardening, installed/enabled a custom tool extension, and tested its isolation and Repeater/context-menu handoffs.
- Hardened packaged app: ARM64 ASAR startup, production origin despite a development URL environment variable, real local proxy traffic, custom extension tool and Settings passed. Native mouse activation inside the extension was also checked in the packaged app.
- Dependency audit: **0 known vulnerabilities** in the checked runtime and development lockfile. Scoped minimatch overrides avoid a build-tool glob denial-of-service advisory without changing old minimatch consumers to an incompatible API. Unused direct dependencies were removed.

macOS ARM64 and x64 DMG/ZIP packages were generated in `release/`. ARM64 was run locally; the Intel package was built but not exercised on Intel hardware. Linux x64/ARM64 Debian and tarball packages were cross-built on a disposable Docker/SSH worker initiated from the Mac. Windows x64/ARM64 NSIS builds use a dedicated local x86_64 Docker/Wine VM. Native Windows/Linux UI acceptance remains pending. Packages have hardened fuses but are local development builds without Developer ID signing or notarization.

## Known boundaries

HTTP/1.1 inspection only. WebSocket upgrade passthrough, not frame-level inspection. SOCKS TCP metadata only. Captured responses are size-bounded; large responses stream without whole-body interception. No OS CA trust installation, automatic updates, independent security audit or enterprise administration in this release. The shop backend is deployed separately. Local development packages are not notarized release artifacts.

Timeline measures proxy-observed network phases, not browser performance. Header checks are advisory. TLS inspection reports one negotiated connection, not an exhaustive protocol/cipher scan. See README for operational details.

## Corporate networking additions

Custom RSA signing CA/issuer-chain import, macOS HTTP/HTTPS + SOCKS toggle, privacy bypass lists and ordered upstream proxy chains are implemented. Additional integration coverage includes HTTP absolute-form forwarding, nested HTTPS relay transport, SOCKS5 authentication, two-hop chains, no direct fallback, opaque excluded CONNECT certificates, private captures, custom/encrypted intermediate CA imports, and mocked exact restoration/rollback/conflict recovery. The universal native helper was compiled and exercised read-only, then successfully restored a real leftover Glasses system-proxy configuration. Automated profiles cannot change system routing. Recovery tests cover external changes, write failures and Quit anyway. Fresh takeover still requires interactive acceptance.

The official home is https://glasses.thugs.red; the website and community backend are maintained separately.

## Documentation

The illustrated 22-page user/developer manual and four-page product overview are in `output/pdf/`. Both use actual local-lab screenshots and the final Affinity branding, with the official Glasses URL. The manual includes an internal linked contents page, operational workflows, the extension API, corporate networking, release boundaries and troubleshooting.

## Repository and licensing

The application repository is https://github.com/kawaiipantsu/glasses. The private website is excluded. Glasses uses CC BY-NC 4.0 plus the additional workplace/consulting permission in LICENSE; commercial redistribution requires separate permission. The README includes actual local-lab screenshots, source/build instructions and linked PDF guides.

## Community client

Implemented opt-in catalog browsing, pinned Ed25519 verification, fixed-origin bounded HTTPS downloads, browser install intents, explicit capability review, disabled or enabled installation, and reviewed upgrades. Eight new tests cover malformed links, signatures, expiry, tampering, capabilities, origin/redirect/size restrictions, race-safe updates, source takeover, downgrade refusal and persistence rollback. A desktop smoke exercises the full flow with ephemeral signed fixtures. The live catalog still returned HTTP 404 during this check; live-server acceptance and platform URL associations remain pending.

Initial GitHub verification, desktop smoke, dependency audit and CodeQL passed for commit c264dab. Hosted package jobs are opt-in and were not run.

CodeQL analysis for the community update completed with 10 open alerts. See [the review](CODEQL-REVIEW.md) for intentional research behavior, existing controls, and two outstanding local filesystem hardening items. No alerts were suppressed or dismissed.
