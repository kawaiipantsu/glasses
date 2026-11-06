import { spawnSync } from 'node:child_process';
import path from 'node:path';
import versioning from './versioning.cjs';
const root = path.resolve(import.meta.dirname, '..');
if (!process.argv.includes('--current')) versioning.advance(root, 'application', 'build');
const info = versioning.stamp(root);
console.log(`Building Glasses ${info.displayVersion} · source ${info.sourceSha256.slice(0, 16)}`);
for (const args of [
  ['tsc', '--noEmit'],
  ['vite', 'build'],
]) {
  const result = spawnSync('npx', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
