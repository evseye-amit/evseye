import { mkdir, writeFile } from 'node:fs/promises';
import { oemCatalog } from './oems.mjs';

const outputDirectory = new URL('./assets/oem/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });

const fallbacks = [];
for (const oem of oemCatalog) {
  if (!oem.logoSourceUrl) continue;
  try {
    const response = await fetch(oem.logoSourceUrl, {
      headers: { 'user-agent': 'EVsEye development seed asset sync' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.startsWith('image/')) {
      throw new Error(`received ${response.status} (${contentType || 'unknown content type'})`);
    }
    await writeFile(
      new URL(`${oem.code}.png`, outputDirectory),
      Buffer.from(await response.arrayBuffer()),
    );
  } catch (error) {
    // A small number of legacy vendor domains no longer publish a favicon.
    // Keep the catalog visually complete without retaining a remote URL in DB.
    const label = oem.displayName.replace(/[&<>"']/g, '').slice(0, 18);
    const initials = label
      .split(/\s+/)
      .map((word) => word[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();
    await writeFile(
      new URL(`${oem.code}.svg`, outputDirectory),
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="${label}"><rect width="256" height="256" rx="48" fill="#07573f"/><text x="128" y="146" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="72" font-weight="700">${initials}</text></svg>`,
    );
    fallbacks.push(oem.code);
  }
}

if (fallbacks.length) {
  console.warn(`Used generated fallback logos for: ${fallbacks.join(', ')}`);
}

console.info(`Prepared ${oemCatalog.length} local OEM logo assets.`);
