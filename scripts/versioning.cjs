const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const label = ({ version, build }) => `${version} (${build})`;
function validate(value) {
  if (!value || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version))
    throw new Error('Version must be major.minor.patch without leading zeros');
  if (
    !Number.isInteger(value.build) ||
    value.build < 1 ||
    value.build > 65535 ||
    value.version.split('.').some((n) => Number(n) > 65535)
  )
    throw new Error(
      'Version components and build must fit native Windows version fields (build 1–65535)',
    );
  return value;
}
const read = (root) => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  if (v.schemaVersion !== 1) throw new Error('Unknown version manifest schema');
  validate(v.application);
  validate(v.documentation);
  validate({
    version: v.documentation.applicationVersion,
    build: v.documentation.applicationBuild,
  });
  return v;
};
function next(value, kind) {
  validate(value);
  if (!['major', 'minor', 'patch', 'build'].includes(kind))
    throw new Error('Use major, minor, patch or build');
  const parts = value.version.split('.').map(Number);
  const index = ['major', 'minor', 'patch'].indexOf(kind);
  if (index >= 0) {
    parts[index]++;
    for (let i = index + 1; i < 3; i++) parts[i] = 0;
  }
  return validate({ ...value, version: parts.join('.'), build: value.build + 1 });
}
function write(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temp, file);
}
function sync(root, check = false) {
  const v = read(root),
    p = path.join(root, 'package.json'),
    l = path.join(root, 'package-lock.json');
  const pkg = JSON.parse(fs.readFileSync(p)),
    lock = JSON.parse(fs.readFileSync(l));
  const wanted = {
    version: v.application.version,
    buildNumber: String(v.application.build),
    bundleVersion: String(v.application.build),
  };
  if (check) {
    if (
      pkg.version !== wanted.version ||
      lock.version !== wanted.version ||
      lock.packages[''].version !== wanted.version ||
      pkg.build.buildNumber !== wanted.buildNumber ||
      pkg.build.mac.bundleVersion !== wanted.bundleVersion
    )
      throw new Error('Version metadata differs: run npm run version:sync');
  } else {
    pkg.version = lock.version = lock.packages[''].version = wanted.version;
    pkg.build.buildNumber = wanted.buildNumber;
    pkg.build.mac.bundleVersion = wanted.bundleVersion;
    write(p, pkg);
    write(l, lock);
    const appLabel = label(v.application),
      docLabel = label(v.documentation);
    for (const [name, link] of [
      ['README.md', 'docs/VERSIONING.md'],
      ['docs/USAGE.md', 'VERSIONING.md'],
    ]) {
      const file = path.join(root, name);
      if (!fs.existsSync(file)) continue;
      let text = fs.readFileSync(file, 'utf8');
      const block = `<!-- versions:start -->\nApplication **${appLabel}** · Documentation **${docLabel}** (covers Glasses ${v.documentation.applicationVersion} (${v.documentation.applicationBuild})). [Version policy](${link}).\n<!-- versions:end -->`;
      if (text.includes('<!-- versions:start -->'))
        text = text.replace(/<!-- versions:start -->[\s\S]*?<!-- versions:end -->/, block);
      else if (name === 'README.md')
        text = text.replace(
          '**0.8.1 (1) is a usable development release.**',
          block + '\n\n**Glasses is a usable development release.**',
        );
      else
        text =
          text.replace('Version **0.8.1 (1)**. Documentation **1.0.0 (1)**.', '') +
          '\n' +
          block +
          '\n';
      if (name === 'README.md')
        text = text.replace(
          /alt="Version [^"]+" src="https:\/\/img.shields.io\/badge\/version-[^"]+"/,
          `alt="Version ${appLabel}" src="https://img.shields.io/badge/version-${v.application.version}_(${v.application.build})-e9374c?style=flat-square"`,
        );
      fs.writeFileSync(file, text);
    }
  }
  return v;
}
function advance(root, component, kind) {
  if (!['application', 'documentation'].includes(component))
    throw new Error('Choose application or documentation');
  const lock = path.join(root, '.version.lock');
  const fd = fs.openSync(lock, 'wx');
  try {
    const v = read(root);
    v[component] = next(v[component], kind);
    if (component === 'documentation') {
      v.documentation.applicationVersion = v.application.version;
      v.documentation.applicationBuild = v.application.build;
    }
    write(path.join(root, 'version.json'), v);
    sync(root);
    return v;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
function stamp(root) {
  const v = sync(root, true);
  const hash = crypto.createHash('sha256');
  function visit(name) {
    const absolute = path.join(root, name),
      stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('Source snapshots cannot contain symlinks: ' + name);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute).sort())
        if (child !== '.DS_Store') visit(name + '/' + child);
    } else {
      hash.update(name + '\0');
      hash.update(fs.readFileSync(absolute));
      hash.update('\0');
    }
  }
  for (const name of [
    'core',
    'electron',
    'src',
    'plugin-sdk',
    'native',
    'scripts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'LICENSE',
    'LICENSES',
    'build/icon.png',
    'build/icon.ico',
    'build/icon.icns',
  ])
    visit(name);
  const sourceSha256 = hash.digest('hex'),
    file = path.join(root, 'build/build-info.json');
  if (fs.existsSync(file)) {
    const prior = JSON.parse(fs.readFileSync(file));
    if (
      prior.sourceSha256 === sourceSha256 &&
      prior.version === v.application.version &&
      prior.build === v.application.build
    )
      return prior;
  }
  let sourceRevision = null;
  try {
    sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {}
  const info = {
    schemaVersion: 1,
    ...v.application,
    displayVersion: label(v.application),
    sourceRevision,
    sourceSha256,
    builtAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  write(file, info);
  return info;
}
module.exports = { label, validate, read, next, sync, advance, stamp };
