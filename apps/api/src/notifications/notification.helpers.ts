import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  INDIAN_MOBILE_INPUT_PATTERN,
  normalizeIndianMobile,
} from '../common/phone.js';

export const CONTENT_LIMIT_BYTES = 3500;
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const digest = (value: unknown): string => hash(JSON.stringify(value));
export function notificationContent(
  title: string,
  body: string,
  data: Record<string, string> = {},
) {
  if (!title?.trim() || !body?.trim())
    throw new BadRequestException('Notification title and body are required.');
  const clean = { title: title.trim(), body: body.trim() };
  if (clean.title.length > 150 || clean.body.length > 2000)
    throw new BadRequestException('Notification title or body is too long.');
  if (
    !data ||
    Array.isArray(data) ||
    typeof data !== 'object' ||
    Object.keys(data).length > 20
  )
    throw new BadRequestException(
      'Notification data must contain at most 20 string values.',
    );
  const reserved = [
    'notificationId',
    'messageId',
    'userId',
    'clientId',
    'from',
    'message_type',
    'collapse_key',
  ];
  for (const [key, value] of Object.entries(data)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) ||
      reserved.includes(key) ||
      /^(google|gcm)/i.test(key) ||
      typeof value !== 'string' ||
      value.length > 1000
    )
      throw new BadRequestException(
        'Notification data contains an invalid or reserved key/value.',
      );
  }
  const sorted = Object.fromEntries(
    Object.entries(data).sort(([a], [b]) => a.localeCompare(b)),
  );
  if (
    Buffer.byteLength(
      JSON.stringify({ notification: clean, data: sorted }),
      'utf8',
    ) > CONTENT_LIMIT_BYTES
  )
    throw new BadRequestException(
      `Notification content must not exceed ${CONTENT_LIMIT_BYTES} UTF-8 bytes, including data.`,
    );
  return { ...clean, data: sorted };
}
export function parsePhones(input?: string) {
  const raw = (input ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (raw.length > 2000)
    throw new BadRequestException(
      'Enter at most 2,000 phone numbers per request. Larger groups can use an All Users audience.',
    );
  const valid = new Set<string>();
  const invalid: string[] = [];
  const duplicates: string[] = [];
  for (const entry of raw) {
    try {
      const clean = entry.replace(/[\s()-]/g, '');
      if (!INDIAN_MOBILE_INPUT_PATTERN.test(clean))
        throw new Error('Invalid phone');
      const phone = normalizeIndianMobile(clean);
      if (valid.has(phone)) duplicates.push(entry);
      else valid.add(phone);
    } catch {
      invalid.push(entry);
    }
  }
  return { phones: [...valid].sort(), invalid, duplicates };
}
export type PageCursor = { at: string; id: string };
export function encodeCursor(at: Date, id: string) {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString(
    'base64url',
  );
}
export function decodeCursor(value?: string): PageCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (
      typeof parsed.at !== 'string' ||
      !Number.isFinite(new Date(parsed.at).getTime()) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id)
    )
      throw new Error();
    return parsed;
  } catch {
    throw new BadRequestException('Invalid notification pagination cursor.');
  }
}
export function afterCursor(cursor: PageCursor | null) {
  return cursor
    ? {
        OR: [
          { createdAt: { lt: new Date(cursor.at) } },
          { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
        ],
      }
    : {};
}
