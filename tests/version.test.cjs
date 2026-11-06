const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const v = require('../scripts/versioning.cjs');

test('semantic changes reset the right components and retain a monotonic build counter', () => {
  const current = { version: '2.4.9', build: 37 };
  assert.deepEqual(v.next(current, 'major'), { version: '3.0.0', build: 38 });
  assert.deepEqual(v.next(current, 'minor'), { version: '2.5.0', build: 38 });
  assert.deepEqual(v.next(current, 'patch'), { version: '2.4.10', build: 38 });
  assert.deepEqual(v.next(current, 'build'), { version: '2.4.9', build: 38 });
  for (const bad of ['01.2.3', '1.2', '1.2.3-beta', '1.2.3+4'])
    assert.throws(() => v.next({ version: bad, build: 1 }, 'build'));
  assert.throws(() => v.next({ version: '1.0.0', build: 65535 }, 'build'));
});

test('documentation builds are independent, app package metadata stays synchronized, and reservations are locked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glasses-versions-'));
  try {
    for (const file of ['version.json', 'package.json', 'package-lock.json'])
      fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
    const before = v.read(root),
      after = v.advance(root, 'documentation', 'minor');
    assert.deepEqual(after.application, before.application);
    assert.equal(after.documentation.build, before.documentation.build + 1);
    assert.equal(after.documentation.applicationVersion, before.application.version);
    const app = v.advance(root, 'application', 'patch');
    assert.deepEqual(app.documentation, after.documentation);
    assert.equal(app.application.build, before.application.build + 1);
    v.sync(root, true);
    fs.writeFileSync(path.join(root, '.version.lock'), '');
    assert.throws(() => v.advance(root, 'application', 'build'), /EEXIST/);
    assert.deepEqual(v.read(root), app);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    pkg.build.buildNumber = '999';
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
    assert.throws(() => v.sync(root, true), /differs/);
    v.sync(root);
    v.sync(root, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('HAR uses the actual application identity without changing the HAR format version', () => {
  const { toHar } = require('../core/formats.cjs');
  const { application } = require('../version.json');
  const har = toHar([]);
  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.creator.version, application.version);
  assert.equal(har.log.creator._build, application.build);
  assert.equal(har.log.creator.comment, v.label(application));
});
