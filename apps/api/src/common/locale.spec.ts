import { describe, expect, it } from 'vitest';
import { requestLocale, translatedProperty } from './locale.js';
import { localizeApiError } from './mobile-error-translations.js';

describe('mobile API localization', () => {
  it('resolves supported languages from Accept-Language and respects preference weights', () => {
    expect(requestLocale('en-IN;q=0.4,te-IN;q=0.9')).toBe('te');
    expect(requestLocale('kn-IN,hi;q=0.8')).toBe('kn');
    expect(requestLocale('hi-IN')).toBe('hi');
    expect(requestLocale('fr-FR')).toBe('en');
    expect(requestLocale('te;q=0')).toBe('en');
  });

  it('translates configured display copy while leaving missing translations in English', () => {
    const translations = { te: { displayName: 'వ్యక్తిగత వివరాలు' } };
    expect(translatedProperty('Personal Profile', translations, 'te', 'displayName')).toBe('వ్యక్తిగత వివరాలు');
    expect(translatedProperty('Personal Profile', translations, 'kn', 'displayName')).toBe('Personal Profile');
  });

  it('translates mobile workflow and field errors without changing field codes', () => {
    expect(localizeApiError('Fleet must be requested before asking for payment.', 'kn')).toBe('ಪಾವತಿ ಕೇಳುವ ಮೊದಲು ಫ್ಲೀಟ್ ವಿನಂತಿಸಬೇಕು.');
    expect(localizeApiError('ADDRESS_PROOF_DOCUMENT must be uploaded before continuing.', 'te')).toBe('కొనసాగించే ముందు ADDRESS_PROOF_DOCUMENT అప్‌లోడ్ చేయండి.');
    expect(localizeApiError('Invalid OTP.', 'hi')).toBe('अमान्य OTP।');
    expect(localizeApiError('companyCode must match /^[a-z0-9-]+$/ regular expression', 'kn')).toBe('companyCode ಸ್ವರೂಪ ಅಮಾನ್ಯವಾಗಿದೆ.');
  });
});
