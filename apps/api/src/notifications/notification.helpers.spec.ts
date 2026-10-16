import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  notificationContent,
  parsePhones,
} from './notification.helpers.js';
import { classifyPushError } from './firebase-push.provider.js';
describe('notification validation and Firebase failure handling', () => {
  it('normalizes and deduplicates mobile numbers and reports invalid entries', () => {
    const result = parsePhones(
      '9876543210, +919876543210, invalid, 9123456789',
    );
    expect(result.phones).toEqual(['+919123456789', '+919876543210']);
    expect(result.duplicates).toEqual(['+919876543210']);
    expect(result.invalid).toEqual(['invalid']);
  });
  it('enforces UTF-8 payload size, including multilingual text and reserved data keys', () => {
    expect(notificationContent(' Title ', ' Body ')).toEqual({
      title: 'Title',
      body: 'Body',
      data: {},
    });
    expect(() => notificationContent('Title', 'क'.repeat(1500))).toThrow(
      'UTF-8',
    );
    expect(() =>
      notificationContent('Title', 'Body', { notificationId: 'spoofed' }),
    ).toThrow('reserved');
    expect(() =>
      notificationContent('Title', 'Body', { key: 1 } as never),
    ).toThrow('reserved');
  });
  it('round trips stable pagination cursors and rejects malformed cursors', () => {
    const at = new Date('2026-10-16T00:00:00Z');
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    expect(decodeCursor(encodeCursor(at, id))).toEqual({
      at: at.toISOString(),
      id,
    });
    expect(() => decodeCursor('malformed')).toThrow('pagination');
  });
  it('disables unregistered tokens but does not disable tokens for malformed message payloads', () => {
    expect(
      classifyPushError({
        code: 'messaging/registration-token-not-registered',
      }),
    ).toMatchObject({ invalidToken: true, retryable: false });
    expect(
      classifyPushError({ code: 'messaging/invalid-argument' }),
    ).toMatchObject({ invalidToken: false, retryable: false });
  });
  it('honors quota backoff and Retry-After', () => {
    expect(
      classifyPushError({
        code: 'messaging/quota-exceeded',
        httpResponse: { headers: { 'retry-after': '120' } },
      }),
    ).toMatchObject({ retryable: true, retryAfterSeconds: 120 });
    expect(
      classifyPushError({ code: 'messaging/quota-exceeded' }),
    ).toMatchObject({ retryAfterSeconds: 60 });
  });
});
