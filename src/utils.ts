import type { Headers, TrafficRecord } from './types';
export const api = window.glasses;
export const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
export const time = (n: number) =>
  n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`;
export const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
export const pathname = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};
export const headerText = (headers: Headers) =>
  Object.entries(headers)
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((value) => `${k}: ${value}`))
    .join('\n');
export function parseHeaders(text: string): Headers {
  const output: Headers = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const at = line.indexOf(':');
    if (at <= 0) throw new Error(`Invalid header: ${line}`);
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (output[key])
      output[key] = [...(Array.isArray(output[key]) ? output[key] : [output[key]]), value];
    else output[key] = value;
  }
  return output;
}
export const decode = (base64: string) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    );
  } catch {
    return '';
  }
};
export const encode = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};
export function asCurl(r: TrafficRecord) {
  const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  return `curl -X ${r.method} ${q(r.url)}${Object.entries(r.requestHeaders)
    .filter(([k]) => !['content-length', 'host'].includes(k))
    .map(([k, v]) => ` \\\n  -H ${q(`${k}: ${v}`)}`)
    .join('')}${r.requestBody ? ` \\\n  --data-raw ${q(decode(r.requestBody))}` : ''}`;
}
export const copy = async (value: string) => navigator.clipboard.writeText(value);
export const transformations = [
  'URL encode',
  'URL decode',
  'Base64 encode',
  'Base64 decode',
  'Hex encode',
  'Hex decode',
  'JSON format',
  'JSON minify',
  'JSON escape',
  'JSON unescape',
  'HTML encode',
  'HTML decode',
  'Uppercase',
  'Lowercase',
] as const;
export function transform(value: string, operation: string) {
  switch (operation) {
    case 'URL encode':
      return encodeURIComponent(value);
    case 'URL decode':
      return decodeURIComponent(value);
    case 'Base64 encode':
      return encode(value);
    case 'Base64 decode':
      return new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(atob(value.replace(/\s/g, '')), (c) => c.charCodeAt(0)),
      );
    case 'Hex encode':
      return [...new TextEncoder().encode(value)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    case 'Hex decode': {
      const hex = value.replace(/\s/g, '');
      if (!/^(?:[\da-fA-F]{2})*$/.test(hex)) throw new Error('Enter pairs of hexadecimal digits');
      return new TextDecoder('utf-8', { fatal: true }).decode(
        new Uint8Array(hex.match(/../g)?.map((x) => parseInt(x, 16)) || []),
      );
    }
    case 'JSON format':
      return JSON.stringify(JSON.parse(value), null, 2);
    case 'JSON minify':
      return JSON.stringify(JSON.parse(value));
    case 'JSON escape':
      return JSON.stringify(value).slice(1, -1);
    case 'JSON unescape':
      return JSON.parse(`"${value}"`);
    case 'HTML encode':
      return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    case 'HTML decode': {
      const el = document.createElement('textarea');
      el.innerHTML = value.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      return el.value;
    }
    case 'Uppercase':
      return value.toUpperCase();
    case 'Lowercase':
      return value.toLowerCase();
    default:
      return value;
  }
}
