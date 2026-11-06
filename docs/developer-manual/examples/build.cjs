// Run from this directory: node build.cjs
// Build-time Node APIs are not available inside the installed extension.
const fs = require('node:fs');
const path = require('node:path');
const { pluginSchema } = require('../../../core/plugins.cjs');
const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const javascript = read('ui.js');
const css = read('ui.css');
// The host inserts these fields into raw script/style elements.
// Reject end tags; JSON escaping alone does not protect HTML parsing.
if (/<\/script\b/i.test(javascript) || /<\/style\b/i.test(css)) {
  throw new Error('Remove embedded script/style end tags from package assets.');
}
const manifest = pluginSchema.parse({
  ...JSON.parse(read('manifest.json')),
  ui: { html: read('ui.html'), css, javascript },
});
const json = JSON.stringify(manifest, null, 2) + '\n';
const bytes = Buffer.byteLength(json, 'utf8');
if (bytes > 256 * 1024) throw new Error(`Package is too large: ${bytes} bytes`);
fs.writeFileSync(path.join(root, 'json-workbench.glasses-plugin.json'), json);
console.log(`Validated package: ${bytes} bytes`);
