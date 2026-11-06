const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./settings.cjs');
class Secrets {
  constructor(dir, storage) {
    this.file = path.join(dir, 'relay-secrets.json');
    this.storage = storage;
    this.items = {};
    if (fs.existsSync(this.file)) this.items = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }
  available() {
    return (
      this.storage.isEncryptionAvailable() &&
      this.storage.getSelectedStorageBackend?.() !== 'basic_text'
    );
  }
  get(id) {
    if (!this.items[id]) return '';
    if (!this.available()) throw new Error('OS credential encryption is unavailable');
    return this.storage.decryptString(Buffer.from(this.items[id], 'base64'));
  }
  update(hops) {
    const next = {};
    for (const hop of hops) {
      if (hop.password !== undefined) {
        if (
          typeof hop.password !== 'string' ||
          Buffer.byteLength(hop.password) > 1024 ||
          /[\r\n\0]/.test(hop.password)
        )
          throw new Error('Invalid relay password');
        if (hop.password) {
          if (!this.available())
            throw new Error(
              'OS credential encryption is unavailable; relay password was not saved',
            );
          next[hop.id] = this.storage.encryptString(hop.password).toString('base64');
        }
      } else if (this.items[hop.id]) next[hop.id] = this.items[hop.id];
    }
    atomicWrite(this.file, next);
    this.items = next;
  }
}
module.exports = { Secrets };
