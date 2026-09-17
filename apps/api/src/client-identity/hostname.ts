import { BadRequestException } from '@nestjs/common';

export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'platform',
  'mail',
  'smtp',
  'cdn',
  'media',
  'assets',
  'static',
  'support',
  'status',
]);
export function normalizeHostname(input: string): string {
  if (!input || input !== input.trim() || /[\s/@\\?#,%]/.test(input))
    throw new BadRequestException('Invalid hostname.');
  const match = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(input);
  if (
    !match ||
    (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))
  )
    throw new BadRequestException('Invalid hostname.');
  const host = match[1].toLowerCase().replace(/\.$/, '');
  if (
    host.length > 253 ||
    !host
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new BadRequestException('Invalid hostname.');
  return host;
}
export function validClientSlug(slug: string): boolean {
  return (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) &&
    !RESERVED_SUBDOMAINS.has(slug)
  );
}
