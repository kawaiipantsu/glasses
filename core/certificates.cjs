const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const net = require('node:net');
const forge = require('node-forge');
const { atomicWrite } = require('./settings.cjs');
class Certificates {
  constructor(dir) {
    this.dir = path.join(dir, 'certificates');
    this.cache = new Map();
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.caPath = path.join(this.dir, 'glasses-ca.pem');
    this.keyPath = path.join(this.dir, 'glasses-ca-key.pem');
    if (fs.existsSync(this.caPath) && fs.existsSync(this.keyPath)) {
      this.pem = fs.readFileSync(this.caPath, 'utf8');
      this.key = forge.pki.privateKeyFromPem(fs.readFileSync(this.keyPath, 'utf8'));
      this.cert = forge.pki.certificateFromPem(this.pem);
    } else {
      const pair = forge.pki.rsa.generateKeyPair(2048);
      this.key = pair.privateKey;
      const cert = forge.pki.createCertificate();
      cert.publicKey = pair.publicKey;
      cert.serialNumber = '01' + crypto.randomBytes(15).toString('hex');
      cert.validity.notBefore = new Date(Date.now() - 86400000);
      cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 86400000);
      cert.setSubject([
        { name: 'commonName', value: 'THUGSred Glasses Local Research CA' },
        { name: 'organizationName', value: 'THUGSred' },
      ]);
      cert.setIssuer(cert.subject.attributes);
      cert.setExtensions([
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
        { name: 'subjectKeyIdentifier' },
      ]);
      cert.sign(this.key, forge.md.sha256.create());
      this.cert = cert;
      this.pem = forge.pki.certificateToPem(cert);
      fs.writeFileSync(this.keyPath, forge.pki.privateKeyToPem(this.key), { mode: 0o600 });
      fs.writeFileSync(this.caPath, this.pem, { mode: 0o600 });
    }
    this.local = { pem: this.pem, cert: this.cert, key: this.key, path: this.caPath };
    this.customPath = path.join(this.dir, 'custom-ca.json');
    this.source = 'local';
    if (fs.existsSync(this.customPath)) {
      const custom = JSON.parse(fs.readFileSync(this.customPath, 'utf8'));
      this.activate(this.validate(custom.pem, custom.key));
    }
    this.leafKeys = forge.pki.rsa.generateKeyPair(2048);
  }
  validate(pem, keyPEM, passphrase) {
    if (Buffer.byteLength(pem) > 1024 * 1024 || Buffer.byteLength(keyPEM) > 65536)
      throw new Error('CA files exceed the import limit');
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!blocks?.length || blocks.length > 12)
      throw new Error('Choose a PEM CA certificate, optionally followed by its issuer chain');
    const chain = blocks.map((p) => new crypto.X509Certificate(p));
    const leaf = chain[0];
    if (!leaf.ca) throw new Error('This certificate is not a CA');
    const key = crypto.createPrivateKey({ key: keyPEM, passphrase });
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048)
      throw new Error('This release supports RSA signing CAs with keys of at least 2048 bits');
    if (!leaf.checkPrivateKey(key))
      throw new Error('The private key does not match the CA certificate');
    const parsed = forge.pki.certificateFromPem(blocks[0]);
    const usage = parsed.getExtension('keyUsage');
    if (usage && !usage.keyCertSign)
      throw new Error('CA key usage does not permit certificate signing');
    for (let i = 0; i < chain.length; i++) {
      if (Date.now() < Date.parse(chain[i].validFrom) || Date.now() >= Date.parse(chain[i].validTo))
        throw new Error('The CA chain contains an expired or not-yet-valid certificate');
      if (
        i + 1 < chain.length &&
        (!chain[i + 1].ca ||
          !chain[i].checkIssued(chain[i + 1]) ||
          !chain[i].verify(chain[i + 1].publicKey))
      )
        throw new Error('The CA chain is not in issuer order or has an invalid signature');
    }
    return {
      pem: blocks.join('\n') + '\n',
      key: key.export({ type: 'pkcs1', format: 'pem' }),
      cert: parsed,
    };
  }
  activate(value) {
    this.pem = value.pem;
    this.cert = value.cert;
    this.key = forge.pki.privateKeyFromPem(value.key);
    this.source = 'custom';
    this.cache.clear();
  }
  import(pem, key, passphrase) {
    const value = this.validate(pem, key, passphrase);
    atomicWrite(this.customPath, { pem: value.pem, key: value.key });
    this.activate(value);
    return this.info();
  }
  useLocal() {
    fs.rmSync(this.customPath, { force: true });
    Object.assign(this, {
      pem: this.local.pem,
      cert: this.local.cert,
      key: this.local.key,
      source: 'local',
    });
    this.cache.clear();
    return this.info();
  }
  leaf(host) {
    host = host.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || host.length > 253 || /[^\w.:-]/.test(host))
      throw new Error('Invalid TLS hostname');
    if (
      Date.now() >= this.cert.validity.notAfter.getTime() ||
      Date.now() < this.cert.validity.notBefore.getTime()
    )
      throw new Error('Signing CA is not currently valid');
    if (this.cache.has(host)) return this.cache.get(host);
    const cert = forge.pki.createCertificate();
    cert.publicKey = this.leafKeys.publicKey;
    cert.serialNumber = '01' + crypto.randomBytes(15).toString('hex');
    cert.validity.notBefore = new Date(
      Math.max(Date.now() - 86400000, this.cert.validity.notBefore.getTime()),
    );
    cert.validity.notAfter = new Date(
      Math.min(Date.now() + 90 * 86400000, this.cert.validity.notAfter.getTime()),
    );
    cert.setSubject([{ name: 'commonName', value: host }]);
    cert.setIssuer(this.cert.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [net.isIP(host) ? { type: 7, ip: host } : { type: 2, value: host }],
      },
    ]);
    cert.sign(this.key, forge.md.sha256.create());
    const value = {
      key: forge.pki.privateKeyToPem(this.leafKeys.privateKey),
      cert: forge.pki.certificateToPem(cert) + this.pem,
    };
    value.context = tls.createSecureContext(value);
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(host, value);
    return value;
  }
  info() {
    const cert = new crypto.X509Certificate(this.pem);
    return {
      path: this.source === 'custom' ? this.customPath : this.caPath,
      source: this.source,
      fingerprint: cert.fingerprint256,
      subject: cert.subject,
      validTo: cert.validTo,
      pem: this.pem,
    };
  }
  issuedByLocalCA(pem) {
    try {
      return new crypto.X509Certificate(pem).verify(new crypto.X509Certificate(this.pem).publicKey);
    } catch {
      return false;
    }
  }
}
module.exports = { Certificates };
