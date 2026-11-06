import path from 'node:path';
import versioning from './versioning.cjs';
const root = path.resolve(import.meta.dirname, '..');
const [command = 'show', component, kind = 'build'] = process.argv.slice(2);
let value;
switch (command) {
  case 'show':
    value = versioning.read(root);
    break;
  case 'check':
    value = versioning.sync(root, true);
    break;
  case 'sync':
    value = versioning.sync(root);
    break;
  case 'next':
    value = versioning.advance(root, component, kind);
    break;
  case 'stamp':
    value = versioning.stamp(root);
    break;
  default:
    throw new Error(
      'Use show, check, sync, next <application|documentation> <major|minor|patch|build>, or stamp',
    );
}
console.log(JSON.stringify(value, null, 2));
