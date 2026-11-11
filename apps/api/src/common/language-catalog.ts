/** Languages the platform can identify. A client offers a locale only after its content is published. */
export const languageCatalog = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
] as const;

export type ApiLocale = (typeof languageCatalog)[number]['code'];
export const supportedLanguageCodes = new Set<string>(languageCatalog.map(({ code }) => code));

export function isSupportedLanguage(code: unknown): code is ApiLocale {
  return typeof code === 'string' && supportedLanguageCodes.has(code);
}

export function languageDetails(codes: readonly string[]) {
  return codes.map((code) => languageCatalog.find((language) => language.code === code))
    .filter((language): language is (typeof languageCatalog)[number] => language !== undefined);
}
