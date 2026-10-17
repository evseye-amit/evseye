import { describe, expect, it } from 'vitest';
import { consentAcceptance, defaultConsentAcceptance, legalHash } from './legal-acceptance.js';

describe('versioned consent acceptance wording', () => {
  it('includes the exact approved declaration for English consent', () => {
    expect(consentAcceptance('PRIVACY_CONSENT', 'en', undefined, true)).toEqual(defaultConsentAcceptance);
  });
  it('requires wording in other document languages before publication', () => {
    expect(() => consentAcceptance('PRIVACY_CONSENT', 'hi', undefined, true)).toThrow('document language');
    expect(consentAcceptance('PRIVACY_POLICY', 'hi', undefined, true)).toBeUndefined();
  });
  it('invalidates acceptance when checkbox or declaration wording changes', () => {
    const original = legalHash('<p>Notice</p>', defaultConsentAcceptance);
    expect(legalHash('<p>Notice</p>', { ...defaultConsentAcceptance, checkboxLabel: 'Updated acceptance' })).not.toBe(original);
    expect(legalHash('<p>Notice</p>', { ...defaultConsentAcceptance, declaration: 'Updated declaration' })).not.toBe(original);
    expect(legalHash('<p>Notice</p>', Object.fromEntries(Object.entries(defaultConsentAcceptance).reverse()))).toBe(original);
  });
  it('rejects missing checkbox text at publication', () => {
    expect(() => consentAcceptance('PRIVACY_CONSENT', 'en', { ...defaultConsentAcceptance, checkboxLabel: '' }, true)).toThrow('checkboxLabel');
  });
});
