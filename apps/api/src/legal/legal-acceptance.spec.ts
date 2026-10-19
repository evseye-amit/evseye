import { describe, expect, it } from 'vitest';
import { consentAcceptance, defaultConsentAcceptance, legalHash } from './legal-acceptance.js';

describe('versioned consent acceptance wording', () => {
  it('uses the approved English defaults when a consent copy is omitted', () => {
    expect(consentAcceptance('PRIVACY_CONSENT', 'en', undefined)).toEqual(defaultConsentAcceptance);
  });

  it('requires localized wording before publishing a non-English consent', () => {
    expect(() => consentAcceptance('PRIVACY_CONSENT', 'hi', undefined, true))
      .toThrow('document language');
  });

  it('includes acceptance wording in the stable document hash', () => {
    const original = legalHash('<p>Notice</p>', defaultConsentAcceptance);
    expect(legalHash('<p>Notice</p>', {
      ...defaultConsentAcceptance,
      checkboxLabel: 'Updated acceptance',
    })).not.toBe(original);
    expect(legalHash('<p>Notice</p>', Object.fromEntries(
      Object.entries(defaultConsentAcceptance).reverse(),
    ))).toBe(original);
  });
});
