# Versions and build identity

Application, documentation and website have **independent** `major.minor.patch (build number)` identities. A document edition records the exact application version/build it covers. The website has its own private manifest and must label downloads and documents with their own identities rather than the website's version.

The application and documentation source of truth is [`version.json`](../version.json). `package.json`, its lockfile and native package metadata are synchronized from it. Standalone production builds and release commands reserve a new number. Validation checks and app launches reuse the current identity; live development reloads do not consume numbers. Extension API **v1**, plugin package versions, HAR **1.2** and native session format **1** remain separate compatibility identifiers.

## Current baseline

- Application: **0.8.1 (33)**.
- Documentation set: **1.0.0 (1)**, covering application **0.8.1 (33)**.
- Build 33 continues **32 confirmed successful build runs** recovered from local execution history through 6 November 2026. The [audit ledger](BUILD_HISTORY.json) records their evidence and six excluded failed/cancelled commands. This is a conservative recoverable count; unrecorded manual runs and CI duplicates are not included. Earlier packages were labeled 0.1.0 without an explicit build counter.
- The application remains in initial development. Version 1.0 is reserved for an accepted, stable release rather than a count of features.

## Development milestone normalization

These labels summarize completed work; they are **not claims of eight previously published releases**. Only 0.1.0 packages actually existed before this versioning baseline.

| Milestone | Implemented scope                                                             |
| --------- | ----------------------------------------------------------------------------- |
| 0.1       | Cross-platform Electron workspace, proxy capture and HTTP/HTTPS inspection    |
| 0.2       | Repeater/fuzz iterations, Timeline, TLS and header inspectors                 |
| 0.3       | Extension tools, context menus and capability boundaries                      |
| 0.4       | Custom organizational signing CA and dedicated settings                       |
| 0.5       | macOS proxy switching, bypass rules and restore recovery                      |
| 0.6       | HTTP/HTTPS/SOCKS relay chains and protected credentials                       |
| 0.7       | Multi-architecture release tooling, manuals and public application repository |
| 0.8       | Verified community catalog, signed package review/install and upgrades        |
| 0.8.1     | Dense workspace, configurable typography, UX fixes and version/build tracking |

## When to increment

Follow [semantic versioning](https://semver.org/): major for incompatible product/API changes, minor for features, patch for compatible fixes. For documents, major means a restructuring or compatibility scope change, minor means substantial new coverage, patch means corrections. Site versions describe the site itself. Build counters increase independently and do not reset on a semantic-version bump. Native Windows fields limit numeric components to 65535; tooling refuses overflow.

```sh
npm run version:show
npm run version:next -- application patch
npm run version:next -- documentation minor
```

A semantic bump also reserves one new build. The documentation bump records the current app version as its reviewed baseline. Commit the manifest and synchronized package files.

## Build a release

```sh
# Automatically reserve the next app build once, then reuse it for every OS/architecture.
npm run release:all
# Individual platform package commands also reserve an app build.
npm run dist:mac
# Standalone production compile also reserves one build.
npm run build

# After version:next, or to retry the SAME reserved source build:
npm run release:all -- --current

# Independently advance the documentation build, generate PDFs and their manifest.
npm run docs:build
# After reserving a documentation version:
npm run docs:build -- --current
```

Use `--current` only for the same reserved release. Never replace published files with different bytes; reserve another build if contents change. Failed attempts may leave gaps, which are intentional. The exclusive version lock prevents concurrent reservations on this checkout. A crash may leave `.version.lock`; remove it only after confirming no version/build command is running. `version:check` detects interrupted package synchronization; `version:sync` repairs it from `version.json`.

All platform targets in one coordinated release share the reserved number. Validation (npm run check) and hosted matrix packaging use the committed identity without incrementing it per runner. Nested platform compiles receive --current so a coordinated release only reserves once. The source digest identifies the input files; the Git revision records the parent checkout and can differ when building uncommitted work. Package hashes identify the actual output bytes.

Application filenames contain `Glasses-0.8.1-build.33-…`. The release directory contains a versioned manifest with byte counts, SHA-256 hashes, source digest and build time, plus a versioned checksum list. macOS uses semantic version as `CFBundleShortVersionString` and the counter as `CFBundleVersion`; Windows has a four-part numeric file version; Debian uses the counter as package revision.

PDF filenames contain their **documentation** version/build. `output/pdf/documentation-manifest.json` gives canonical names, current convenience aliases, hashes and the covered application. Covers, page furniture and PDF metadata carry both identities. The old `Glasses-0.1-User-Manual.pdf` is an archived pre-versioning document, not the current manual.

The app displays its identity in the status bar, window title and Settings → About, where **Copy version information** includes OS, architecture and source identity. HAR exports and native session exports also identify the creating app; protocol/format versions are unchanged.
