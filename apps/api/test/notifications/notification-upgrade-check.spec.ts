import { describe, expect, it } from 'vitest';
import { validateRehearsalUrl } from '../../scripts/notification-upgrade-check.mjs';
describe('snapshot rehearsal URL guard', () => {
  it('allows an explicit disposable localhost database', () => {
    expect(() =>
      validateRehearsalUrl(
        'postgresql://postgres@127.0.0.1:58473/notification_test_rehearsal',
      ),
    ).not.toThrow();
  });
  it.each([
    'postgresql://user@staging.example:5432/notification_test_rehearsal',
    'postgresql://user@localhost:5432/production',
    'postgresql://user@localhost/notification_test_rehearsal',
    'postgresql://user@localhost:5432/notification_test_rehearsal?host=production.example',
  ])('rejects unsafe or ambiguous target %s', (value) => {
    expect(() => validateRehearsalUrl(value)).toThrow();
  });
});
