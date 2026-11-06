const net = require('node:net');
function createSocks(
  onConnection,
  connect = (host, port) =>
    new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
    }),
) {
  const sockets = new Set();
  const server = net.createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => {});
    client.setTimeout(30000, () => client.destroy());
    let buffer = Buffer.alloc(0),
      state = 'greeting',
      upstream;
    const fail = (code) => {
      if (!client.destroyed) client.end(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]));
    };
    const parse = (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length > 65536) return client.destroy();
      if (state === 'greeting') {
        if (buffer.length < 2) return;
        const n = buffer[1];
        if (buffer[0] !== 5 || n === 0) return client.destroy();
        if (buffer.length < n + 2) return;
        if (!buffer.subarray(2, n + 2).includes(0)) {
          client.end(Buffer.from([5, 255]));
          return;
        }
        client.write(Buffer.from([5, 0]));
        buffer = buffer.subarray(n + 2);
        state = 'request';
      }
      if (state !== 'request' || buffer.length < 5) return;
      if (buffer[0] !== 5 || buffer[1] !== 1 || buffer[2] !== 0) return fail(7);
      const type = buffer[3];
      let length = type === 1 ? 4 : type === 4 ? 16 : type === 3 ? buffer[4] : -1;
      if (length <= 0) return fail(8);
      const offset = type === 3 ? 5 : 4;
      if (buffer.length < offset + length + 2) return;
      const addr = buffer.subarray(offset, offset + length);
      const host =
        type === 1
          ? [...addr].join('.')
          : type === 3
            ? addr.toString()
            : Array.from({ length: 8 }, (_, i) => addr.readUInt16BE(i * 2).toString(16)).join(':');
      const port = buffer.readUInt16BE(offset + length);
      const rest = buffer.subarray(offset + length + 2);
      if (!port || /[\0\s]/.test(host)) return fail(8);
      state = 'connecting';
      client.pause();
      client.removeListener('data', parse);
      const started = Date.now();
      const controller = new AbortController();
      client.once('close', () => {
        controller.abort();
        upstream?.destroy();
      });
      void (async () => {
        const entry = await onConnection({ host, port, started });
        try {
          upstream = await connect(host, port, controller.signal);
          if (client.destroyed) {
            upstream.destroy();
            return;
          }
          sockets.add(upstream);
          upstream.setTimeout(30000, () => upstream.destroy(new Error('SOCKS tunnel timeout')));
          state = 'tunnel';
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (rest.length) upstream.write(rest);
          let sent = rest.length,
            received = 0;
          client.on('data', (chunk) => (sent += chunk.length));
          upstream.on('data', (chunk) => (received += chunk.length));
          upstream.on('error', (err) => {
            entry?.('error', err.message);
            client.destroy();
          });
          upstream.on('close', () => {
            sockets.delete(upstream);
            entry?.('close', { sent, received, duration: Date.now() - started });
            client.destroy();
          });
          client.pipe(upstream);
          upstream.pipe(client);
          client.resume();
        } catch (e) {
          entry?.('error', e.message);
          fail(5);
        }
      })().catch(() => fail(5));
    };
    client.on('data', parse);
  });
  server.disconnect = () => {
    for (const socket of sockets) socket.destroy();
  };
  server.shutdown = () => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  };
  return server;
}
module.exports = { createSocks };
