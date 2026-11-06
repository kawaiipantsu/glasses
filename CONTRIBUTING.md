# Contributing to Glasses

Start with a focused issue or pull request describing the problem and the resulting behavior. For bugs, include the Glasses version, OS/architecture, reproducible steps, and a minimal local example. Remove credentials, cookies, personal traffic, and private CA material from reports. Follow [SECURITY.md](SECURITY.md) for exploitable findings.

## Development

Use Node.js 24 LTS. Run `npm ci`, then `npm run dev`. The built-in Local lab provides reproducible traffic without an external target.

- `npm run check` validates TypeScript, builds the UI, and runs core/network tests.
- `npm run test:ui` checks desktop behavior using an isolated profile and ephemeral ports.
- `npm run test:community` checks signed review, installation, and explicit upgrades with local fixtures.
- `npm run test:recovery` checks recovery/shutdown behavior without modifying OS proxies.
- `npm run format:check` verifies formatting.

Add focused regression coverage for protocol, security, routing, or state-management changes. For visible UI changes, include screenshots from the local lab. Describe which platforms you actually exercised.

## Boundaries to preserve

Keep remote content inert in application views. Validate privileged IPC inputs and callers. Do not add unrestricted filesystem, shell, network, or Electron bridges to renderers or extensions. Preserve request evidence instead of altering it to make rendering safe. Document protocol and capture limitations.

Plugins are a good starting point: see the [SDK](plugin-sdk/README.md) and [worked tutorial](docs/developer-manual/README.txt). A plugin can add a complete tool or contextual actions without expanding application privileges.

## Repository scope

This repository contains the desktop application, SDK, tests, documentation, and branding. The website and its backend are maintained separately. Never commit local build configuration, credentials, captured traffic, generated private CAs, dependencies, or release binaries.

Contributions must be yours to submit. Submit contributions under the repository's [licensing terms](LICENSE), including its additional workplace permission. Third-party material must retain its notices and be compatible with this distribution. No contributor license agreement or transfer of copyright is requested here.
