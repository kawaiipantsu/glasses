import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..', 'build');
const source = fs
  .readFileSync(path.join(root, '../docs/brand/Glasses-Red-Shades.svg'), 'utf8')
  .replace(/^[\s\S]*?(?=<svg\b)/, '')
  .replace(
    'width="100%" height="100%" viewBox="0 0 1200 440"',
    'width="1080" height="370" viewBox="60 40 1080 370"',
  );
if (/<(?:image|text)\b/.test(source))
  throw new Error('Export the Affinity mark as vector curves, without embedded images.');
fs.writeFileSync(path.join(root, 'glasses-mark.svg'), source);
const mark = source.replace(
  /<svg\b([^>]*)>/,
  (_, attributes) =>
    `<svg${attributes.replace(
      /\s(?:width|height)="[^"]*"/g,
      '',
    )} x="94" y="354" width="836" height="286">`,
);
const svg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="icon-surface" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#30343f"/><stop offset=".48" stop-color="#1b1e27"/><stop offset="1" stop-color="#0e1119"/></linearGradient>
    <linearGradient id="icon-rim" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#717787" stop-opacity=".52"/><stop offset=".5" stop-color="#414653" stop-opacity=".38"/><stop offset="1" stop-color="#12151d"/></linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="214" fill="url(#icon-surface)"/>
  <rect x="65.5" y="65.5" width="893" height="893" rx="212.5" fill="none" stroke="url(#icon-rim)" stroke-width="3"/>
  ${mark}</svg>`,
);
fs.writeFileSync(path.join(root, 'icon.svg'), svg);
await sharp(svg).resize(1024, 1024).png().toFile(path.join(root, 'icon.png'));
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(
  icoSizes.map((size) => sharp(svg).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, i) => {
  const entry = 6 + 16 * i;
  header[entry] = icoSizes[i] === 256 ? 0 : icoSizes[i];
  header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
fs.writeFileSync(path.join(root, 'icon.ico'), Buffer.concat([header, ...images]));
if (process.platform === 'darwin') {
  const dir = path.join(root, 'icon.iconset');
  fs.mkdirSync(dir, { recursive: true });
  for (const size of [16, 32, 128, 256, 512])
    for (const scale of [1, 2])
      await sharp(svg)
        .resize(size * scale, size * scale)
        .png()
        .toFile(path.join(dir, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
  const result = spawnSync('iconutil', ['-c', 'icns', dir, '-o', path.join(root, 'icon.icns')], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('iconutil failed');
  fs.rmSync(dir, { recursive: true });
}
console.log('Application icons generated.');
