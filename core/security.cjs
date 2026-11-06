const fs = require('node:fs/promises');
const path = require('node:path');
function trustedSender(event, window, dev) {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    return false;
  try {
    const u = new URL(event.senderFrame.url);
    return (
      (u.protocol === 'glasses:' && u.hostname === 'app' && u.pathname === '/index.html') ||
      Boolean(dev && u.origin === 'http://127.0.0.1:5173')
    );
  } catch {
    return false;
  }
}
// Local operational metadata only: never request URLs, headers, bodies, CA keys or raw errors.
class SecurityLog {
  constructor(dir) {
    this.file = path.join(dir, 'security-events.jsonl');
    this.queue = Promise.resolve();
    this.pending = 0;
  }
  record(event, outcome = 'ok') {
    if (this.pending >= 100) return;
    this.pending++;
    const row =
      JSON.stringify({
        time: new Date().toISOString(),
        event: String(event)
          .replace(/[^a-z_.-]/g, '')
          .slice(0, 60),
        outcome: String(outcome)
          .replace(/[^a-z_.-]/g, '')
          .slice(0, 30),
      }) + '\n';
    this.queue = this.queue.then(async () => {
      try {
        const stat = await fs.stat(this.file).catch(() => null);
        if (stat?.size > 1024 * 1024) {
          await fs.rm(this.file + '.1', { force: true });
          await fs.rename(this.file, this.file + '.1');
        }
        await fs.appendFile(this.file, row, { mode: 0o600 });
      } catch {
      } finally {
        this.pending--;
      }
    });
  }
}
module.exports = { trustedSender, SecurityLog };
