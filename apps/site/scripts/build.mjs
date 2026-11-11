import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const page of ['index.html', '404.html']) {
  const html = await readFile(path.join(site, page), 'utf8');
  if (/blog(?:\.html|\b|[-_])/i.test(html)) {
    throw new Error('The unpublished blog must not appear on the marketing site.');
  }
  for (const [, attr] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (attr.startsWith('#') || /^[a-z]+:/i.test(attr) || attr === '/') continue;
    const target = attr.split('#')[0].split('?')[0].replace(/^\//, '');
    if (!target || target.startsWith('/') || target.includes('..')) throw new Error(`Invalid local asset: ${attr}`);
    const file = path.join(site, target);
    if (!(await stat(file).catch(() => null))?.isFile()) throw new Error(`Missing local asset: ${attr}`);
  }
}

const output = path.join(site, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(site, 'index.html'), path.join(output, 'index.html'));
await cp(path.join(site, '404.html'), path.join(output, '404.html'));
await cp(path.join(site, 'assets'), path.join(output, 'assets'), { recursive: true });
console.log(`Built static marketing site in ${output}`);
