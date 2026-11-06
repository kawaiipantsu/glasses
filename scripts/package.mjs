import { spawnSync } from 'node:child_process';
import path from 'node:path';
import versioning from './versioning.cjs';
const root = path.resolve(import.meta.dirname, '..');
const target = process.argv[2];
if (!['mac', 'mac-local', 'linux', 'win', 'dir'].includes(target))
  throw new Error('Unknown package target');
if (!process.argv.includes('--current')) versioning.advance(root, 'application', 'build');
versioning.sync(root, true);
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
if (target.startsWith('mac')) run('npm', ['run', 'native']);
run('npm', ['run', 'build', '--', '--current']);
const args = {
  mac: ['--mac', 'dmg', 'zip', '--arm64', '--x64'],
  'mac-local': ['--mac', 'dmg', '--arm64'],
  linux: ['--linux', 'tar.gz', 'deb', '--arm64', '--x64'],
  dir: ['--dir'],
};
if (target === 'win') {
  for (const arch of ['--x64', '--arm64'])
    run('npx', ['electron-builder', '--win', 'nsis', arch, '--publish', 'never']);
} else run('npx', ['electron-builder', ...args[target], '--publish', 'never']);
