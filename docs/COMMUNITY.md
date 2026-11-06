# Community browsing and installation

Open **Community → Connect and browse** to allow requests to `https://glasses.thugs.red`. No account is required for public browsing and installation. Connections are off by default and can be disabled in **Settings → Plugins & community**. Searches and package identifiers go to the service; captured traffic does not.

The application-side client is implemented. On 6 November 2026, Data Lens, Research headers, JSON Workbench and Lab Marker were published through the production community service. All four production signatures/hashes and installations passed in an isolated packaged macOS profile. JSON Workbench formatting and its host text-preview bridge were also exercised. Signed local fixtures cover review/install/update and rejection paths. Browser-to-application OS handoff remains a manual acceptance item.

## Install and update

1. Search or filter the catalog, then choose **Review install**. The app downloads and verifies the package before showing its permissions.
2. Read every capability, especially access to selected traffic. The review identifies newly requested permissions for an update.
3. Choose **Install disabled** to inspect it later, or **Install & enable** to activate its declared capabilities immediately.
4. Manage activation and removal in **Plugins**. A new community version requires another review. There are no silent or automatic updates.

Website links use `glasses://install?id=red.thugs.example&version=1.0.0`. A valid link opens or focuses the app and queues an install request; it does not download, install, or activate code by itself. Choose **Review package** to continue. Only the latest pending browser request is retained. Invalid URLs, duplicate/extra parameters, arbitrary download URLs, and noncanonical version strings are rejected.

Packaged macOS, Windows, and Linux builds declare the `glasses` URL scheme. The installed app attempts OS registration; development and automated-test profiles do not. If your browser cannot open the link, open Community directly, or download the JSON manifest and use **Plugins → Install from file**. Native OS/browser association acceptance is required on each target platform.

Community updates can replace only an earlier community installation with the same ID. A manually installed package with that ID must be removed explicitly before switching sources. Downgrades and same-version replacements are refused. If the installed package changes after review, fetch a new review. Review authorizations expire; the app does not install from an expired preview.

## Verification and trust

The main process uses a narrow HTTPS GET client for a fixed service origin. It does not route downloads through the research proxy or use the research CA. TLS verification uses the runtime's public roots; redirects, credentials in URLs, compressed responses, overlarge responses, and requests lasting over 20 seconds are refused. Corporate networks requiring a special proxy or private TLS root may therefore make Community unavailable; manual file installation remains supported.

Install descriptors are Ed25519 envelopes. The app verifies the signature over the exact decoded payload bytes, checks time validity, package/version identity, a fixed canonical download path, capability set, byte length, and SHA-256, then applies the existing v1 plugin validator. Packages remain JSON manifests capped at 256 KiB. A service response cannot introduce a new trusted signing key.

The pinned production key is:

```text
keyId: community-2026-01
Ed25519 public key (raw, Base64):
tr6LkVRoOFO1kzFLg642gn1UEoRS1z8x4AHfXRtYd2M=
```

This is a public verification key, not a secret. Key rotation needs a coordinated application trust update. Tests generate separate ephemeral keys in the test process; production exposes no key-override setting or environment variable.

A verified signature authenticates community distribution, not the safety of the code or the identity claimed in a manifest author field. Extension sandbox and capability boundaries remain in force. Revocation can stop future downloads; the app does not remotely remove existing installations or poll a revocation feed.

## Public API consumed by the app

- `GET /api/v1/catalog?q=&kind=plugin|extension&page=1`
- `GET /api/v1/packages/{id}/versions/{version}/install`
- `GET /api/v1/packages/{id}/versions/{version}/download`

The catalog contains `schemaVersion`, `items`, and pagination metadata. Display data is validated and rendered as text. The app ignores service-supplied install URLs and builds endpoints from validated IDs and versions.

The install envelope contains `algorithm`, `keyId`, `payload`, and `signature`. Payload and signature use canonical unpadded base64url. The payload contains `schemaVersion`, `packageId`, `version`, `sha256`, `size`, `downloadUrl`, `capabilities`, `issuedAt`, and `expiresAt`. Descriptors normally last five minutes; the client rejects lifetimes above ten minutes, future issue times beyond 60 seconds, and expired authorization.

See [the SDK](../plugin-sdk/README.md) for the unchanged plugin manifest and bridge. Website account management, publishing, and moderation live in the separate private website project.
