import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const vite = spawn(
  process.execPath,
  [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))],
  { stdio: 'inherit' },
);
let electron;
const stop = () => {
  electron?.kill();
  vite.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (let i = 0; i < 100; i++) {
  const ready = await new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:5173', (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
  });
  if (ready) {
    electron = spawn(require('electron'), ['.'], {
      stdio: 'inherit',
      env: { ...process.env, GLASSES_DEV_URL: '1' },
    });
    electron.on('exit', () => {
      vite.kill();
    });
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!electron) {
  stop();
  throw new Error('Vite did not start');
}
