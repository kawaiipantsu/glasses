import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const requested = process.argv[2] || 'all';
if (!['all', 'mac', 'win', 'linux'].includes(requested))
  throw new Error('Use all, mac, win or linux');
const configFile = path.join(root, '.glasses-build.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
const output = path.join(root, 'release');
fs.mkdirSync(output, { recursive: true });
const logDir = path.join(output, 'build-logs');
fs.mkdirSync(logDir, { recursive: true });
const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const log = options.log ? fs.createWriteStream(options.log) : null;
    const child = spawn(command, args, {
      cwd: root,
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => {
      process.stdout.write(b);
      log?.write(b);
    });
    child.stderr.on('data', (b) => {
      process.stderr.write(b);
      log?.write(b);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      log?.end();
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}
const capture = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
function snapshot(file) {
  // Explicit allowlist: never send the website, credentials, .git, or local captures.
  const files = [
    'core',
    'electron',
    'src',
    'build',
    'plugin-sdk',
    'native',
    'scripts',
    'tests',
    'LICENSE',
    'LICENSES',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
  ];
  execFileSync(
    '/usr/bin/tar',
    ['-czf', file, '--no-xattrs', '--exclude=build/native', '--exclude=.DS_Store', ...files],
    { cwd: root, env: { ...process.env, COPYFILE_DISABLE: '1' } },
  );
}
async function build(platform) {
  if (platform === 'mac')
    return run('npm', ['run', 'dist:mac'], {
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
      log: path.join(logDir, 'mac.log'),
    });
  const worker = config[platform] || { kind: 'docker' };
  const image =
    worker.image ||
    (platform === 'win' ? 'electronuserland/builder:wine' : 'electronuserland/builder:latest');
  const targets = platform === 'win' ? '--win nsis' : '--linux tar.gz deb';
  const packaging =
    platform === 'win'
      ? 'npx electron-builder --win nsis --x64 --publish never && npx electron-builder --win nsis --arm64 --publish never'
      : `npx electron-builder ${targets} --x64 --arm64 --publish never`;
  const command = `npm ci && npm run build && ${packaging}`;
  const workRoot = path.join(root, '.build-work');
  fs.mkdirSync(workRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(workRoot, 'glasses-build-')),
    archive = path.join(temp, 'source.tgz');
  snapshot(archive);
  try {
    if (worker.kind === 'ssh') {
      if (!/^[a-zA-Z0-9_.@:-]+$/.test(worker.host || ''))
        throw new Error('Set a valid SSH build host in .glasses-build.json');
      const args = [
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'LogLevel=ERROR',
        ...(worker.identity ? ['-i', worker.identity.replace(/^~(?=\/)/, os.homedir())] : []),
      ];
      const remote = capture('ssh', [
        ...args,
        worker.host,
        'mktemp -d /var/tmp/glasses-build.XXXXXXXX',
      ]);
      if (!/^\/var\/tmp\/glasses-build\.[a-zA-Z0-9]+$/.test(remote))
        throw new Error('Unexpected remote temporary path');
      try {
        await run('scp', [...args, archive, `${worker.host}:${remote}/source.tgz`]);
        const work = `mkdir ${quote(remote + '/project')} && tar -xzf ${quote(remote + '/source.tgz')} -C ${quote(remote + '/project')} && docker run --rm --cpus=4 --memory=6g -e CSC_IDENTITY_AUTO_DISCOVERY=false -v ${quote(remote + '/project:/project')} -w /project ${quote(image)} bash -lc ${quote(command)}`;
        await run('ssh', [...args, worker.host, work], {
          log: path.join(logDir, platform + '.log'),
        });
        const extension = platform === 'win' ? '*.exe' : '*.deb *.tar.gz';
        await run('ssh', [
          ...args,
          worker.host,
          `cd ${quote(remote + '/project/release')} && tar -czf ${quote(remote + '/artifacts.tgz')} ${extension}`,
        ]);
        await run('scp', [
          ...args,
          `${worker.host}:${remote}/artifacts.tgz`,
          path.join(temp, 'artifacts.tgz'),
        ]);
        await run('/usr/bin/tar', ['-xzf', path.join(temp, 'artifacts.tgz'), '-C', output]);
      } finally {
        await run('ssh', [...args, worker.host, `rm -rf -- ${quote(remote)}`]);
      }
    } else {
      const args = worker.context ? ['--context', worker.context] : [];
      // Compile on the container filesystem, not macOS shared storage.
      const extensions = platform === 'win' ? '*.exe' : '*.deb *.tar.gz';
      const containerCommand = `mkdir -p /work /artifacts/release && tar -xzf /artifacts/source.tgz -C /work && cd /work && ${command} && cd release && cp ${extensions} /artifacts/release/`;
      await run(
        'docker',
        [
          ...args,
          'run',
          '--rm',
          '--cpus=4',
          '--memory=4g',
          '-e',
          'CSC_IDENTITY_AUTO_DISCOVERY=false',
          '-v',
          `${temp}:/artifacts`,
          '-v',
          'glasses-build-npm:/root/.npm',
          '-v',
          'glasses-build-electron:/root/.cache/electron',
          '-v',
          'glasses-build-builder:/root/.cache/electron-builder',
          '-w',
          '/',
          image,
          'bash',
          '-lc',
          containerCommand,
        ],
        { log: path.join(logDir, platform + '.log') },
      );
      for (const name of fs.readdirSync(path.join(temp, 'release')))
        if (/\.(exe|deb|tar\.gz)$/.test(name))
          fs.copyFileSync(path.join(temp, 'release', name), path.join(output, name));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
for (const platform of requested === 'all' ? ['mac', 'linux', 'win'] : [requested])
  await build(platform);
const artifacts = fs
  .readdirSync(output)
  .filter((n) => /\.(dmg|zip|exe|deb|tar\.gz)$/.test(n))
  .sort();
fs.writeFileSync(
  path.join(output, 'SHA256SUMS'),
  artifacts
    .map(
      (n) =>
        `${crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(output, n)))
          .digest('hex')}  ${n}`,
    )
    .join('\n') + '\n',
);
console.log('Release artifacts and SHA256SUMS are in ' + output);
