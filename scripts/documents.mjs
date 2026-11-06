import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import versioning from './versioning.cjs';
const root = path.resolve(import.meta.dirname, '..');
if (!process.argv.includes('--current')) versioning.advance(root, 'documentation', 'build');
const versions = versioning.sync(root, true);
const doc = versions.documentation;
const output = path.join(root, 'output/pdf');
const python = process.env.GLASSES_PYTHON || 'python3';
const fingerprintFile = path.join(root, 'docs/developer-manual/source-fingerprints.json');
const fingerprints = JSON.parse(fs.readFileSync(fingerprintFile));
fingerprints.host_version = doc.applicationVersion;
fingerprints.host_build = doc.applicationBuild;
fingerprints.documentation = { version: doc.version, build: doc.build };
fingerprints.note =
  'SHA-256 values identify source reviewed for this documentation edition. Git revision may be the parent of uncommitted authoring changes.';
for (const name of [
  ...Object.keys(fingerprints.files),
  'version.json',
  'core/version.cjs',
  'docs/VERSIONING.md',
])
  fingerprints.files[name] = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, name)))
    .digest('hex');
fs.writeFileSync(fingerprintFile, JSON.stringify(fingerprints, null, 2) + '\n');
for (const script of ['scripts/manuals.py', 'docs/developer-manual/build_manual.py']) {
  const result = spawnSync(python, [script], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const names = [
  ['Glasses-User-Manual', 'pdf'],
  ['Glasses-Product-Overview', 'pdf'],
  ['Glasses-Developer-Manual-API-v1', 'pdf'],
  ['Glasses-Developer-Manual-Companion', 'zip'],
];
const companion = spawnSync(python, ['scripts/docs-companion.py'], { cwd: root, stdio: 'inherit' });
if (companion.error) throw companion.error;
if (companion.status !== 0) process.exit(companion.status || 1);
const artifacts = names.map(([name, extension]) => {
  const alias = name + '.' + extension;
  const filename = `${name}-${doc.version}-build.${doc.build}.${extension}`;
  fs.copyFileSync(path.join(output, alias), path.join(output, filename));
  return {
    filename,
    alias,
    bytes: fs.statSync(path.join(output, filename)).size,
    sha256: crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(output, filename)))
      .digest('hex'),
  };
});
const manifest = {
  schemaVersion: 1,
  documentation: doc,
  displayVersion: versioning.label(doc),
  artifacts,
};
const encoded = JSON.stringify(manifest, null, 2) + '\n';
fs.writeFileSync(
  path.join(output, `Glasses-Documentation-${doc.version}-build.${doc.build}-manifest.json`),
  encoded,
);
fs.writeFileSync(path.join(output, 'documentation-manifest.json'), encoded);
console.log(
  `Documentation ${versioning.label(doc)} covers Glasses ${doc.applicationVersion} (${doc.applicationBuild})`,
);
