import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
if (process.platform === 'darwin') {
  fs.mkdirSync('build/native', { recursive: true });
  for (const arch of ['arm64', 'x86_64'])
    execFileSync(
      'xcrun',
      [
        'swiftc',
        'native/proxy-helper.swift',
        '-O',
        '-target',
        `${arch}-apple-macos13.0`,
        '-o',
        `build/native/proxy-helper-${arch}`,
      ],
      { stdio: 'inherit' },
    );
  execFileSync(
    'lipo',
    [
      '-create',
      'build/native/proxy-helper-arm64',
      'build/native/proxy-helper-x86_64',
      '-output',
      'build/native/proxy-helper',
    ],
    { stdio: 'inherit' },
  );
  console.log('Built universal macOS proxy helper (arm64 + x64).');
}
