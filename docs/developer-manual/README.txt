GLASSES DEVELOPER MANUAL - API v1
Documentation: 1.0.0 (1) | Host: Glasses 0.8.1 (33) | API v1

The PDF is output/pdf/Glasses-Developer-Manual-API-v1.pdf.
The companion archive preserves repository-relative paths. Extract it into a
Glasses source checkout, or inspect/install the generated example JSON directly.
Do not install manifest.json: it is a build input without the UI assets.

INSTALLABLE EXAMPLES
  docs/developer-manual/examples/lab-marker.glasses-plugin.json
  docs/developer-manual/examples/json-workbench.glasses-plugin.json

In Glasses: Plugins > Install from file > review > Install plugin > Enable.
To replace an existing ID, remove its previous package, install, then enable.
Reload tool reloads the already-installed manifest; it does not read source files.

BUILD AND VERIFY THE TUTORIAL (from the Glasses repository root)
  npm ci
  node docs/developer-manual/examples/build.cjs
  npm run build
  node docs/developer-manual/examples/verify.mjs

The project recommends Node 24. verify.mjs is developer-only Playwright/Electron
automation. It uses a temporary profile and an available loopback port; it does
not change OS proxy settings. It is not installed extension runtime code.

REBUILD THE PDF
  python3 docs/developer-manual/build_manual.py

Requires ReportLab and the DejaVu Sans regular/bold/oblique and Sans Mono TTFs.
The builder checks bundled Codex fonts and /usr/share/fonts/truetype/dejavu.
Set GLASSES_MANUAL_FONT_DIR if your fonts are elsewhere. It uses the repository's
existing docs/brand/glasses-preview.png, which is not duplicated in this archive.
For PDF review, install Poppler and run:
  pdftoppm -r 100 -png output/pdf/Glasses-Developer-Manual-API-v1.pdf /tmp/glasses-manual

FILES
  manual_content.py       Full authored content and code-listing references
  build_manual.py         ReportLab layout, bookmarks and linked contents
  layout-report.json      Content-bottom measurements from the latest build
  source-fingerprints.json  SHA-256 inventory of reviewed repository files
  verification.json       Checks actually run for this edition
  examples/               Complete tutorial source and installable examples

NOTES
  The examples preserve the v1 sandbox and use only the public extension bridge.
  JSON formatting is not lossless for large integers, duplicate keys or number
  spellings. Preparing a Repeater draft does not send a request.
  Glasses uses CC BY-NC 4.0 with an additional workplace/consulting permission.
  Read LICENSE before redistribution. See the PDF's distribution chapter.
