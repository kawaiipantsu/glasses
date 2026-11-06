# Glasses extension API v1

A Glasses plugin is a UTF-8 `.json` manifest, up to 256 KiB. Install it in **Plugins → Install from file**, review the declared capabilities, then enable it. No backend or account is required. Installation starts disabled. Replacement requires removing the previous version; disabling/removal also removes sidebar/menu contributions and unloads an active tool.

Two working examples:

- [`examples/security-headers.json`](examples/security-headers.json): matching header rewrite and response check.
- [`examples/data-lens.json`](examples/data-lens.json): complete HTML/CSS/JavaScript tool, sidebar entry, selection-aware context actions and a Repeater handoff.

The runtime validator is [`core/plugins.cjs`](../core/plugins.cjs). Invalid capabilities, header injection, duplicate contribution IDs, oversized content and unexpected manifest properties are rejected.

## Manifest

```json
{
  "apiVersion": 1,
  "id": "org.example.data-tool",
  "name": "Data Tool",
  "version": "1.0.0",
  "author": "Example Community",
  "description": "Inspect selected data in a custom workflow.",
  "capabilities": ["ui.tools", "ui.contextMenus", "selection.read"],
  "tools": [{ "id": "tool", "label": "Data Tool" }],
  "contextMenus": [
    {
      "id": "inspect",
      "label": "Inspect selection",
      "contexts": ["request.body", "response.body"]
    }
  ],
  "ui": {
    "html": "<h1>Data Tool</h1><pre id='out'></pre>",
    "css": "h1 { color: #ef5a62; }",
    "javascript": "glassesPlugin.onContext(c => { document.getElementById('out').textContent = c.selection || ''; });"
  }
}
```

`rules`, `checks`, `tools` and `contextMenus` default to empty arrays. IDs are lowercase dotted or hyphenated identifiers; versions use `major.minor.patch`. Tool/action IDs must be unique within a package. The label is the sidebar/menu text; the plugin's HTML can implement its own views, tabs and workflow.

## Capabilities

| Capability             | Allows                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `ui.tools`             | Register up to 10 sidebar tools                                                            |
| `ui.contextMenus`      | Register up to 30 contextual commands                                                      |
| `selection.read`       | Receive selected text for a contextual invocation (up to 1 MiB)                            |
| `traffic.readSelected` | Receive the selected request/response record, including headers and captured base64 bodies |
| `text.transform`       | Present a text result in the host's transform preview                                      |
| `repeater.write`       | Prepare a validated request draft in Repeater; never send automatically                    |
| `request.headers`      | Apply declared request-header rules                                                        |
| `response.headers`     | Apply declared response-header rules                                                       |
| `response.analyze`     | Add declared header observations to Header Hardening                                       |

UI declarations require their corresponding capability. The host strips undeclared data from context messages and ignores bridge operations without permission. Publishers should request only what their tool needs; selected traffic can contain secrets.

## Context menu surfaces

`traffic`, `request.headers`, `request.body`, `response.headers`, `response.body`, `repeater`, `intercept`, `timeline`, `tls`.

Commands appear only on their declared surfaces, grouped by plugin name. Invoking a command opens the plugin pane. The host provides a context object:

```js
glassesPlugin.onContext((context) => {
  // command: contribution ID, or "open" for a sidebar launch
  // view: the originating view, or "tool"
  // toolId: sidebar tool ID when launched from navigation
  // selection: present only with selection.read
  // record: present only with traffic.readSelected
});
```

The last context is also available as `window.glassesContext`. A record contains a stable `id`, URL/method, headers, base64 request/response bodies, byte counts, status, source, timing observations and truncation information. Body strings are base64 to preserve bytes; compressed captures retain content-encoding headers.

## Host bridge

```js
// Requires text.transform. Opens a preview; does not mutate captured traffic.
glassesPlugin.showText('transformed result');

// Requires repeater.write. Validated by the main process; the user clicks Send.
glassesPlugin.sendToRepeater({
  url: 'https://example.com/api',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"example":true}',
  bodyEncoding: 'utf8', // or "base64" for bytes
});
```

Treat untrusted input as text: use `textContent`, not `innerHTML`, to display captured content. Use local JavaScript bundled into the manifest; there are no remote imports or CDN dependencies. The host bridge accepts at most 20 messages/second from the active frame, and text results are capped at 1 MiB. UI CPU/memory quotas are not yet implemented; disable a misbehaving extension and report it.

## Header rules and checks

Rules have `id`, `name`, `enabled`, `phase` (`request`/`response`), literal URL-substring `match`, `action` (`set-header`/`remove-header`), `header`, and `value`. Rule names appear in the request's applied-rules list. Transport-managed headers cannot be modified through this API.

Checks have `header`, `when` (`missing`/`present`/`contains`), optional match `value`, `title`, and `advice`. Matches produce advisory findings attributed to the plugin. They do not execute scanner code or automatically send requests.

## Isolation model

Extension HTML/JS is served through a separate custom scheme and rendered in an opaque-origin frame with `sandbox="allow-scripts"`. Response CSP denies network, subframes, workers, plugins, form submission and base URL changes. It allows only inline package code/styles and data images. The application denies external requests in its UI session, denies permission requests, blocks extension navigation to external origins, and does not expose the application preload bridge to the frame. Parent/child communication is checked against the actual active frame and narrowed by capabilities. Remote research browsing is a different session.

No arbitrary extension JavaScript runs in the Node main process or proxy engine. No direct filesystem, shell, OS APIs or clipboard permissions are exposed. These restrictions are part of the first-release design; they are not a substitute for an independent audit or a future signed publisher ecosystem.

Future versions may add negotiated API revisions, packaged assets, persistent per-plugin state, proxy hook workers, trusted integration brokers, a signed catalog and automatic updates. API v1 does not silently grant these privileges.
