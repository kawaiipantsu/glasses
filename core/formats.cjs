const releaseInfo = require('./version.cjs');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const decoders = {
  gzip: promisify(zlib.gunzip),
  deflate: promisify(zlib.inflate),
  br: promisify(zlib.brotliDecompress),
};
let activeDecodes = 0;
async function decodedBody(record, side) {
  const headers = record[side + 'Headers'] || {};
  let buffer = Buffer.from(record[side + 'Body'] || '', 'base64');
  const encoding = String(headers['content-encoding'] || '');
  const decoder = Object.hasOwn(decoders, encoding) ? decoders[encoding] : undefined;
  if (decoder) {
    if (activeDecodes >= 4)
      return {
        text: '',
        base64: buffer.toString('base64'),
        binary: true,
        error: 'Decoder busy. Select the request again to retry.',
      };
    activeDecodes++;
    try {
      buffer = await decoder(buffer, { maxOutputLength: 16 * 1024 * 1024 });
    } catch {
      return {
        text: '',
        base64: buffer.toString('base64'),
        binary: true,
        error: 'Compressed content is incomplete or exceeds the decode limit',
      };
    } finally {
      activeDecodes--;
    }
  }
  const type = String(headers['content-type'] || '');
  const binary =
    /image|audio|video|octet-stream|pdf|font|zip/i.test(type) ||
    buffer.subarray(0, 4096).includes(0);
  return {
    text: binary ? '' : buffer.toString('utf8'),
    base64: buffer.toString('base64'),
    binary,
    bytes: buffer.length,
  };
}
const headersArray = (headers) =>
  Object.entries(headers || {}).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((value) => ({ name, value: String(value) })),
  );
function toHar(records) {
  return {
    log: {
      version: '1.2',
      creator: {
        name: 'THUGSred Glasses',
        version: releaseInfo.version,
        _build: releaseInfo.build,
        comment: releaseInfo.displayVersion,
      },
      entries: records
        .filter((r) => /^https?:/.test(r.url))
        .map((r) => ({
          startedDateTime: r.startedAt,
          time: r.duration,
          request: {
            method: r.method,
            url: r.url,
            httpVersion: 'HTTP/1.1',
            headers: headersArray(r.requestHeaders),
            queryString: [...new URL(r.url).searchParams].map(([name, value]) => ({ name, value })),
            cookies: [],
            headersSize: -1,
            bodySize: r.requestBytes,
            ...(r.requestBody
              ? {
                  postData: {
                    mimeType: r.requestHeaders['content-type'] || 'application/octet-stream',
                    text: Buffer.from(r.requestBody, 'base64').toString('utf8'),
                    _base64: r.requestBody,
                  },
                }
              : {}),
          },
          response: {
            status: r.status,
            statusText: '',
            httpVersion: 'HTTP/1.1',
            headers: headersArray(r.responseHeaders),
            cookies: [],
            content: {
              size: r.responseBytes,
              mimeType: r.responseHeaders['content-type'] || 'application/octet-stream',
              text: r.responseBody,
              encoding: 'base64',
            },
            redirectURL: r.responseHeaders.location || '',
            headersSize: -1,
            bodySize: r.responseBytes,
          },
          cache: {},
          timings: {
            blocked: -1,
            dns: r.timings.dns ?? -1,
            connect:
              r.timings.connect === undefined ? -1 : r.timings.connect - (r.timings.dns || 0),
            ssl: r.timings.tls === undefined ? -1 : r.timings.tls - (r.timings.connect || 0),
            send: 0,
            wait: Math.max(
              0,
              (r.timings.firstByte || 0) - (r.timings.tls || r.timings.connect || 0),
            ),
            receive: Math.max(0, r.duration - (r.timings.firstByte || 0)),
          },
          _glasses: { truncated: r.truncated, source: r.source, error: r.error },
        })),
    },
  };
}
module.exports = { decodedBody, toHar };
