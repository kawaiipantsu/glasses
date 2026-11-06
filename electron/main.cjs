const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  dialog,
  shell,
  session,
  nativeTheme,
  safeStorage,
  protocol,
  net,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { z } = require('zod');
const { SystemProxy } = require('../core/system-proxy.cjs');
const { Secrets } = require('../core/secrets.cjs');
const { Settings, atomicWrite, schema: settingsSchema } = require('../core/settings.cjs');
const { Certificates } = require('../core/certificates.cjs');
const { Plugins, ruleSchema } = require('../core/plugins.cjs');
const { Engine, requestSchema } = require('../core/engine.cjs');
const { inspectHeaders, inspectTLS } = require('../core/inspectors.cjs');
const { decodedBody, toHar } = require('../core/formats.cjs');
const { createDemo } = require('../core/demo.cjs');
const { PLUGIN_CSP, pluginDocument } = require('../core/plugin-document.cjs');
const { trustedSender, SecurityLog } = require('../core/security.cjs');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'glasses',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  { scheme: 'glasses-plugin', privileges: { standard: true, secure: true } },
]);
if (process.env.GLASSES_TEST_DATA) app.setPath('userData', process.env.GLASSES_TEST_DATA);
let main,
  settings,
  certificates,
  plugins,
  engine,
  demo,
  securityLog,
  systemProxy,
  relaySecrets,
  quitting = false;
const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) app.quit();
app.on('second-instance', () => {
  if (main && !main.isDestroyed()) {
    main.show();
    main.focus();
  }
});
const devMode = !app.isPackaged && Boolean(process.env.GLASSES_DEV_URL);
const appIcon = path.join(__dirname, '../build/icon.png');
const researchers = new Set();
let researchRouting = true;
async function routeResearch(enabled) {
  researchRouting = enabled;
  for (const win of researchers) {
    await win.webContents.session.setProxy(
      enabled
        ? {
            proxyRules: `http=127.0.0.1:${engine.port};https=127.0.0.1:${engine.port}`,
            proxyBypassRules: '<-loopback>',
          }
        : { mode: 'system' },
    );
    await win.webContents.session.closeAllConnections();
  }
}
const emit = (type, data) => {
  if (main && !main.isDestroyed()) main.webContents.send('glasses:event', { type, data });
};
async function writeDialog(name, content, filters) {
  const result = await dialog.showSaveDialog(main, {
    defaultPath: path.join(settings.value.exportPath || app.getPath('documents'), name),
    filters,
  });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.writeFile(result.filePath, content, { mode: 0o600 });
  return result.filePath;
}
async function readDialog(filters) {
  const result = await dialog.showOpenDialog(main, { properties: ['openFile'], filters });
  if (result.canceled) return null;
  const file = result.filePaths[0];
  const handle = await fs.promises.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
      throw new Error('Select a regular file up to 64 MB');
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error('File changed while being read');
    return { file, content: buffer.subarray(0, offset).toString('utf8') };
  } finally {
    await handle.close();
  }
}
function requireRecord(id) {
  const record = engine.records.get(z.string().parse(id));
  if (!record) throw new Error('Request is no longer in this session');
  return record;
}
async function researchBrowser(url) {
  requestSchema.parse({ url, method: 'GET', headers: {} });
  if (!engine.running) await engine.start();
  const ses = session.fromPartition(`glasses-research-${crypto.randomUUID()}`);
  await ses.setProxy(
    researchRouting
      ? {
          proxyRules: `http=127.0.0.1:${engine.port};https=127.0.0.1:${engine.port}`,
          proxyBypassRules: '<-loopback>',
        }
      : { mode: 'system' },
  );
  ses.setPermissionRequestHandler((_, __, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setCertificateVerifyProc((request, cb) => {
    try {
      const cert = new crypto.X509Certificate(request.certificate.data);
      const match = require('node:net').isIP(request.hostname)
        ? cert.checkIP(request.hostname)
        : cert.checkHost(request.hostname);
      cb(
        certificates.issuedByLocalCA(request.certificate.data) &&
          match &&
          Date.now() < Date.parse(cert.validTo) &&
          Date.now() >= Date.parse(cert.validFrom)
          ? 0
          : -3,
      );
    } catch {
      cb(-3);
    }
  });
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Glasses research browser',
    icon: appIcon,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  researchers.add(win);
  win.on('closed', () => researchers.delete(win));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (!/^https?:\/\//.test(target)) event.preventDefault();
  });
  await win.loadURL(url);
  return true;
}
function createWindow() {
  main = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1050,
    minHeight: 700,
    title: 'Glasses · THUGSred',
    icon: appIcon,
    backgroundColor: '#14161b',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  main.webContents.on('will-navigate', (e) => e.preventDefault());
  main.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !event.url.startsWith('glasses-plugin://')) event.preventDefault();
  });
  main.webContents.on('will-redirect', (event) => event.preventDefault());
  main.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(false));
  main.webContents.session.setPermissionCheckHandler(() => false);
  main.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  main.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] },
    (details, cb) => {
      const dev =
        devMode &&
        /^(?:http|ws):\/\/127\.0\.0\.1:5173\//.test(details.url) &&
        (details.resourceType === 'mainFrame' ||
          details.frame?.url.startsWith('http://127.0.0.1:5173'));
      cb({ cancel: !dev });
    },
  );
  if (devMode) main.loadURL('http://127.0.0.1:5173');
  else main.loadURL('glasses://app/index.html');
  main.on('closed', () => {
    main = null;
  });
}
app.whenReady().then(async () => {
  if (!instanceLock) return;
  app.dock?.setIcon(appIcon);
  const root = path.resolve(__dirname, '../dist');
  protocol.handle('glasses', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Forbidden', { status: 403 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep))
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  const dir = app.getPath('userData');
  settings = new Settings(dir);
  certificates = new Certificates(dir);
  plugins = new Plugins(dir);
  engine = new Engine(settings, certificates, plugins);
  relaySecrets = new Secrets(dir, safeStorage);
  engine.router.password = (id) => relaySecrets.get(id);
  systemProxy = new SystemProxy(dir, {
    platform: process.env.GLASSES_TEST_DATA ? 'test' : process.platform,
    helper: app.isPackaged
      ? path.join(process.resourcesPath, 'proxy-helper')
      : path.join(__dirname, '../build/native/proxy-helper'),
  });
  if (systemProxy.snapshot) {
    try {
      await systemProxy.restore();
    } catch (e) {
      settings.warning = e.message;
    }
  }
  securityLog = new SecurityLog(dir);
  securityLog.record('application.started');
  protocol.handle('glasses-plugin', (request) => {
    const url = new URL(request.url);
    const p = plugins.items.find((p) => p.enabled && p.manifest.id === url.host && p.manifest.ui);
    if (!p || url.pathname !== '/index.html')
      return new Response('Plugin unavailable', { status: 404 });
    return new Response(pluginDocument(p.manifest), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': PLUGIN_CSP,
        'cache-control': 'no-store',
        'permissions-policy':
          'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()',
      },
    });
  });
  const rulesPath = path.join(dir, 'rules.json');
  if (fs.existsSync(rulesPath)) {
    try {
      engine.rules = z
        .array(ruleSchema)
        .max(200)
        .parse(JSON.parse(fs.readFileSync(rulesPath, 'utf8')));
    } catch {}
  }
  for (const event of ['record', 'removed', 'status', 'job', 'clear'])
    engine.on(event, (data) => emit(event, data));
  nativeTheme.on('updated', () => emit('appearance', nativeTheme.shouldUseDarkColors));
  ipcMain.handle('glasses:invoke', async (event, action, value) => {
    if (!trustedSender(event, main, devMode)) {
      securityLog.record('ipc.rejected', 'untrusted_sender');
      throw new Error('Invalid caller');
    }
    if (
      [
        'start',
        'stop',
        'settings',
        'rules',
        'pluginInstall',
        'pluginToggle',
        'pluginRemove',
        'importSession',
        'exportSession',
        'exportHAR',
        'exportCA',
        'importCA',
        'localCA',
        'toggleProxy',
      ].includes(action)
    )
      securityLog.record('action.' + action.toLowerCase());
    try {
      switch (action) {
        case 'bootstrap':
          return {
            settings: settings.value,
            status: engine.status(),
            records: [...engine.records.values()],
            rules: engine.rules,
            plugins: plugins.items,
            ca: certificates.info(),
            systemProxy: systemProxy.status(),
            dark: nativeTheme.shouldUseDarkColors,
            platform: process.platform,
            testMode: Boolean(process.env.GLASSES_TEST_DATA),
            version: app.getVersion(),
            dataPath: dir,
            warning: settings.warning,
          };
        case 'start':
          return await engine.start();
        case 'stop':
          await systemProxy.restore();
          emit('systemProxy', systemProxy.status());
          for (const win of researchers) win.close();
          return await engine.stop();
        case 'intercept':
          return engine.setIntercept(z.boolean().parse(value));
        case 'resolve':
          await engine.resolveIntercept(z.string().parse(value.id), value.edit);
          return true;
        case 'clear':
          engine.clear();
          return true;
        case 'replay':
          return await engine.replay(value);
        case 'run':
          return engine.run(value);
        case 'cancelRun':
          engine.cancelJob(z.string().parse(value));
          return true;
        case 'inspectHeaders': {
          const record = requireRecord(value);
          return [...inspectHeaders(record), ...plugins.analyze(record)];
        }
        case 'inspectTLS': {
          const input = z.string().max(4096).parse(value);
          const url = new URL(input.includes('://') ? input : `https://${input}`);
          if (await engine.excluded(url.hostname))
            throw new Error('Destination is on the privacy bypass list');
          return await inspectTLS(input, settings.value.timeoutSeconds * 1000, engine.router);
        }
        case 'body': {
          const id = z.string().parse(value.id);
          const side = z.enum(['request', 'response']).parse(value.side);
          return decodedBody(requireRecord(id), side);
        }
        case 'saveBody': {
          const record = requireRecord(value.id);
          const side = z.enum(['request', 'response']).parse(value.side);
          return await writeDialog(
            `${side}-${record.number}.bin`,
            Buffer.from(record[side + 'Body'], 'base64'),
          );
        }
        case 'saveText':
          return await writeDialog(
            z.enum(['certificate.pem', 'transformed.txt', 'timings.json']).parse(value.name),
            z
              .string()
              .max(32 * 1024 * 1024)
              .parse(value.text),
          );
        case 'settings': {
          const old = settings.value;
          const hops = z
            .array(z.object({ password: z.string().max(1024).optional() }).passthrough())
            .max(8)
            .parse(value.relayHops || []);
          const clean = {
            ...value,
            relayHops: hops.map(({ password, ...hop }) => ({
              ...hop,
              hasPassword:
                password === undefined ? Boolean(relaySecrets.items[hop.id]) : Boolean(password),
            })),
          };
          const checked = settingsSchema.parse(clean);
          if (
            systemProxy.snapshot &&
            ['proxyPort', 'socksPort', 'socksEnabled'].some((k) => old[k] !== checked[k])
          )
            throw new Error('Toggle the system proxy off before changing listener ports');
          relaySecrets.update(hops);
          const updated = settings.update(checked);
          if (
            old.bypassList !== updated.bypassList ||
            old.relayEnabled !== updated.relayEnabled ||
            JSON.stringify(old.relayHops) !== JSON.stringify(updated.relayHops) ||
            hops.some((h) => h.password !== undefined)
          ) {
            engine.disconnect();
            for (const id of engine.jobs.keys()) engine.cancelJob(id);
            await routeResearch(researchRouting);
          }
          return {
            settings: updated,
            restartRequired:
              engine.running &&
              ['proxyPort', 'socksPort', 'socksEnabled'].some((k) => old[k] !== updated[k]),
          };
        }
        case 'toggleProxy': {
          if (!systemProxy.supported)
            throw new Error(
              'System proxy changes are disabled in test sessions and unsupported platforms',
            );
          try {
            if (systemProxy.snapshot) {
              await systemProxy.restore();
              await routeResearch(false);
              if (systemProxy.warning) emit('error', systemProxy.warning);
            } else {
              const existing = await systemProxy.detected();
              if (
                !settings.value.relayEnabled &&
                existing.some((s) => s.http || s.https || s.socks || s.pac)
              )
                throw new Error(
                  'An existing network proxy or PAC configuration was detected. Configure Proxy & interception > Proxy / SOCKS relaying first so Glasses can reach your corporate network.',
                );
              if (!engine.running) await engine.start();
              await systemProxy.enable(engine.status());
              await routeResearch(true);
            }
            return systemProxy.status();
          } finally {
            emit('systemProxy', systemProxy.status());
          }
        }
        case 'detectedProxies':
          return await systemProxy.detected();
        case 'testRelay': {
          const input = requestSchema.parse({
            url: z.string().max(4096).parse(value),
            method: 'GET',
            headers: {},
          });
          const target = new URL(input.url),
            start = Date.now();
          if (await engine.excluded(target.hostname))
            throw new Error('Test destination is on the privacy bypass list');
          const socket = await engine.router.connect(
            target.hostname,
            Number(target.port) || (target.protocol === 'https:' ? 443 : 80),
            { tls: target.protocol === 'https:' },
          );
          socket.destroy();
          return { milliseconds: Date.now() - start, hops: engine.router.hops().length };
        }
        case 'importCA': {
          if (engine.running) throw new Error('Stop the proxy before changing the signing CA');
          const passphrase = z
            .string()
            .max(1024)
            .parse(value || '');
          const pem = await readDialog([
            { name: 'CA certificate / chain (PEM)', extensions: ['pem', 'crt', 'cer'] },
          ]);
          if (!pem) return null;
          const key = await readDialog([
            { name: 'CA signing private key (PEM)', extensions: ['pem', 'key'] },
          ]);
          if (!key) return null;
          const ca = certificates.import(pem.content, key.content, passphrase || undefined);
          emit('ca', ca);
          return ca;
        }
        case 'localCA': {
          if (engine.running) throw new Error('Stop the proxy before changing the signing CA');
          const ca = certificates.useLocal();
          emit('ca', ca);
          return ca;
        }
        case 'openWebsite':
          await shell.openExternal('https://glasses.thugs.red');
          return true;
        case 'chooseExportPath': {
          const result = await dialog.showOpenDialog(main, {
            properties: ['openDirectory', 'createDirectory'],
          });
          return result.canceled ? null : result.filePaths[0];
        }
        case 'openData':
          await shell.openPath(dir);
          return true;
        case 'exportCA':
          return await writeDialog('glasses-ca.pem', certificates.pem);
        case 'rules': {
          const rules = z.array(ruleSchema).max(200).parse(value);
          atomicWrite(rulesPath, rules);
          engine.rules = rules;
          return rules;
        }
        case 'pluginPreview': {
          const result = await readDialog([{ name: 'Glasses plugin', extensions: ['json'] }]);
          return result ? plugins.preview(result.content) : null;
        }
        case 'pluginInstall':
          return plugins.install(value);
        case 'pluginToggle':
          return plugins.toggle(z.string().parse(value.id), z.boolean().parse(value.enabled));
        case 'pluginRemove':
          return plugins.remove(z.string().parse(value));
        case 'pluginExample':
          return await writeDialog(
            'security-headers.glasses-plugin.json',
            fs.readFileSync(path.join(__dirname, '../plugin-sdk/examples/security-headers.json')),
          );
        case 'pluginToolExample':
          return await writeDialog(
            'data-lens.glasses-plugin.json',
            fs.readFileSync(path.join(__dirname, '../plugin-sdk/examples/data-lens.json')),
          );
        case 'validateDraft':
          return requestSchema.parse(value);
        case 'browser':
          return await researchBrowser(value ? z.string().parse(value) : settings.value.browserUrl);
        case 'demo': {
          if (!demo) demo = await createDemo();
          if (!engine.running) await engine.start();
          for (const endpoint of [
            '/',
            '/api/products',
            '/api/profile',
            '/api/search?q=glasses',
            '/api/slow',
            '/api/missing',
          ]) {
            const record = await engine.replay({
              url: demo.url + endpoint,
              method: 'GET',
              headers: { accept: endpoint === '/' ? 'text/html' : 'application/json' },
            });
            record.source = 'local lab';
            engine.publish(record);
          }
          return demo.url;
        }
        case 'exportSession':
          return await writeDialog(
            'research.glasses.json',
            JSON.stringify(
              { format: 'glasses', version: 1, records: [...engine.records.values()] },
              null,
              2,
            ),
            [{ name: 'Glasses session', extensions: ['json'] }],
          );
        case 'exportHAR':
          return await writeDialog(
            'research.har',
            JSON.stringify(toHar([...engine.records.values()]), null, 2),
            [{ name: 'HTTP archive', extensions: ['har'] }],
          );
        case 'importSession': {
          const file = await readDialog([
            { name: 'Glasses session or HAR', extensions: ['json', 'har'] },
          ]);
          if (!file) return 0;
          const data = JSON.parse(file.content);
          let records;
          if (data.format === 'glasses' && data.version === 1) records = data.records;
          else if (data.log?.entries)
            records = data.log.entries.map((e) => ({
              url: e.request.url,
              method: e.request.method,
              startedAt: e.startedDateTime,
              requestHeaders: Object.fromEntries(
                e.request.headers.map((h) => [h.name.toLowerCase(), h.value]),
              ),
              responseHeaders: Object.fromEntries(
                e.response.headers.map((h) => [h.name.toLowerCase(), h.value]),
              ),
              requestBody:
                e.request.postData?._base64 ||
                Buffer.from(e.request.postData?.text || '').toString('base64'),
              responseBody:
                e.response.content.encoding === 'base64'
                  ? e.response.content.text || ''
                  : Buffer.from(e.response.content.text || '').toString('base64'),
              status: e.response.status,
              duration: e.time,
              requestBytes: Math.max(0, e.request.bodySize),
              responseBytes: Math.max(0, e.response.content.size),
              timings: {},
              protocol: e.request.url.startsWith('https:') ? 'HTTPS' : 'HTTP',
            }));
          else throw new Error('Unrecognized session format');
          if (!Array.isArray(records) || records.length > settings.value.maxSessions)
            throw new Error('Session exceeds configured request count');
          const normalized = records.map((r) => {
            const req = requestSchema.parse({
              url: r.url,
              method: r.method,
              headers: r.requestHeaders,
              body: r.requestBody || '',
              bodyEncoding: 'base64',
            });
            const safe = z
              .object({
                responseHeaders: require('../core/engine.cjs').headerSchema,
                responseBody: z.string().max(24 * 1024 * 1024),
                status: z.number().int().min(0).max(599),
                duration: z.number().min(0).max(86400000),
                requestBytes: z.number().min(0),
                responseBytes: z.number().min(0),
                startedAt: z.string().datetime({ offset: true }),
              })
              .parse(r);
            return {
              ...safe,
              url: req.url,
              method: req.method,
              requestHeaders: req.headers,
              requestBody: req.body,
              timings: {},
              source: 'imported',
              state: 'complete',
              protocol: req.url.startsWith('https:') ? 'HTTPS' : 'HTTP',
              truncated: Boolean(r.truncated),
            };
          });
          for (const r of normalized) {
            engine.bodyBytes += r.requestBody.length + r.responseBody.length;
            engine.create(r);
          }
          engine.trim();
          return normalized.length;
        }
        default:
          throw new Error('Unknown application action');
      }
    } catch (error) {
      securityLog.record('action.failed', 'validation_or_operation');
      throw new Error(
        error.issues
          ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : error.message,
      );
    }
  });
  const template = [
    {
      label: 'Glasses',
      submenu: [
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => emit('navigate', 'settings'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  if (settings.value.autoStart) engine.start().catch((e) => emit('error', e.message));
});
app.on('activate', () => {
  if (!main && engine) createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  Promise.resolve(systemProxy?.restore())
    .then(() => {
      for (const win of researchers) win.destroy();
      demo?.server.close();
      return engine?.stop();
    })
    .then(() => app.quit())
    .catch(async (e) => {
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Keep Glasses open', 'Quit anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Proxy settings could not be restored',
        message: 'You can still quit Glasses.',
        detail:
          e.message +
          '\n\nQuit anyway closes the app and keeps the recovery journal for the next launch. Some network services may still point to the stopped proxy.',
      });
      if (result.response === 1) {
        for (const win of researchers) win.destroy();
        demo?.server.close();
        await engine?.stop();
        app.quit();
        return;
      }
      quitting = false;
      if (!main) createWindow();
      emit('error', e.message);
      emit('systemProxy', systemProxy.status());
    });
});
