# Building Glasses

The Mac is the source of truth. `scripts/releases.mjs` creates temporary application-only snapshots for other builders, retrieves packages into `release/`, and removes the snapshots. No second maintained checkout is needed. The separate website, captures, credentials, Git metadata, and local build configuration are excluded.

## Requirements

- Node.js 24 LTS, npm, and `npm ci` in the checkout.
- macOS packaging: Xcode command-line tools (`xcode-select --install`).
- Windows cross-build: Docker with an **x86_64 Linux** environment and Wine. On an Apple Silicon Mac, use a dedicated x86_64 Colima VM.
- Linux cross-build: an x86_64 Linux Docker worker, local or reachable over SSH. It can package both x64 and ARM64 because Glasses currently has no architecture-specific native Node add-ons. Changes to dependencies may require native builders.

Windows/Linux packages must still be exercised on their target operating systems. Successful packaging is not runtime acceptance.

## One-time worker setup

For a local Windows build VM with Colima installed:

```sh
colima start glasses-build --arch x86_64 --cpu 4 --memory 4 \
  --disk 40 --root-disk 40 --activate=false --vm-type=qemu
```

The dedicated profile keeps build images separate from other Docker projects. The first image download is large; later builds reuse it. Local workers compile on their disposable container filesystem; named `glasses-build-*` Docker volumes retain only npm/Electron/builder download caches, not a source checkout. x86_64 emulation on Apple Silicon is slower than native packaging.

Copy the example to the ignored local configuration file:

```sh
cp glasses-build.example.json .glasses-build.json
```

Configure a local Docker context for Windows and either Docker or SSH for Linux. The sample deliberately contains no real infrastructure addresses or key paths. For SSH, verify the server's host key in advance; the script requires strict host-key checking and noninteractive authentication. The worker needs Docker permission and enough temporary disk space. Secrets remain in local SSH/key configuration, not the repository.

Pin `image` to a verified Docker image digest for repeatable toolchain selection. The example shows image tags for initial setup; inspect the pulled image with `docker image inspect` to obtain its repository digest.

## Release commands

```sh
npm run check
npm run release:all
# Or one target:
npm run release:windows
npm run release:linux
```

`release:all` runs macOS, Linux, then Windows. Start the configured local Docker VM before invoking it. Linux SSH workers use `/var/tmp/glasses-build.*` only for the current job. Containers are removed after execution; existing worker projects and Docker caches are not pruned. Local staging uses `.build-work/`, which is ignored by Git. A failed build still attempts temporary-directory cleanup.

Packages, `SHA256SUMS`, and `build-logs/` return to `release/`. Do not run two builds of the same target concurrently. After builds finish:

```sh
cd release
shasum -a 256 -c SHA256SUMS
```

Stop the dedicated VM when finished if you want to release its memory:

```sh
colima stop glasses-build
```

## Native platform commands

```sh
npm run dist:mac          # arm64 + x64 DMG/ZIP; must run on macOS
npm run dist:mac:local    # Apple Silicon DMG
npm run dist:linux        # arm64 + x64 tarball/Debian, on Linux
npm run dist:win          # separate x64 and ARM64 NSIS installers, on Windows/Wine
```

The GitHub workflow runs verification on pushes and pull requests. Hosted multi-platform packaging is optional: manually run **Verify and package Glasses** with **packages** enabled. It uploads artifacts without publishing a GitHub release. This is an additional build route, not a requirement for the Mac-controlled workflow.

## Verification and signing

```sh
npm run test:ui           # isolated Electron desktop checks and screenshots
npm run test:community    # signed community review/install/update with isolated fixtures
npm run test:recovery     # test-profile routing guard and quit/recovery behavior
npm run test:packaged     # hardened macOS ARM64 package smoke after packaging
npm run security:check    # build, integration tests, dependency audit
```

Automated test profiles cannot change system routing. Use a dedicated test machine/profile for interactive OS proxy and certificate-trust acceptance.

The central builder deliberately disables automatic certificate discovery and produces unsigned development packages. Authenticated distribution needs a separate signing step or an explicitly configured signed build. macOS requires Developer ID signing and notarization; Windows requires a code-signing identity. Keep signing credentials outside the repository and worker snapshots. See electron-builder's [signing documentation](https://www.electron.build/code-signing) and [multi-platform guidance](https://www.electron.build/multi-platform-build).

See [release notes](RELEASE_NOTES.md) for actual test results, not just configured targets.

## Versioned builds

Application and documentation use independent semantic versions and monotonically increasing build counters. See [version policy and commands](VERSIONING.md) and [historical build audit](BUILD_HISTORY.json). `release:all` reserves one app build for the whole platform matrix; use `-- --current` only to build an already reserved identity. Versioned artifact manifests include hashes, sizes and source identity. Never replace a published build with different bytes.
