# Mobile language rollout

The platform catalog is available at `GET /api/v1/public/app/languages`. It includes English and Assamese, Bengali, Gujarati, Hindi, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu, and Urdu. The catalog identifies languages; it does not automatically publish translated content.

`SELECT_APP_LANGUAGE.configuration.supportedLocales` is the published package/client choice for each mobile workflow. Keep `en` as the initial default. Before adding a locale for a client and app:

1. Publish that locale's Terms & Conditions and Privacy Policy for the app and role. Rider also needs its Privacy Notice cum Consent Form if `ACCEPT_RIDER_PRIVACY_CONSENT` is enabled. Each legal document needs its own reviewed version and effective date. The app bootstrap rejects a configuration with missing published documents.
2. Translate mandatory workflow component copy, login, and onboarding field labels, placeholders, and validation text in `configuration.translations[locale]`. Optional intro slides belong in `SHOW_APP_INTRO.configuration.translations[locale]`; the intro stays off until every offered locale has slides.
3. Ship the corresponding Flutter screen strings for Rider and Fleet Manager before enabling the locale. The current Fleet Manager bundle has full screen translations for `en`, `hi`, `kn`, and `te`; other catalog languages currently use English for bundled text. API error and status strings also fall back to English when no translation exists.
4. Publish the revised Feature, Package, and client workflow versions, then check `GET /api/v1/public/app/bootstrap` for each app/role. Its `supportedLocales` and `languages` contain only configured locales with the required legal documents.

The selected locale travels in `Accept-Language` for Fleet Manager API calls and as a locale parameter for pre-login legal requests. Legal acceptance records the exact published document, version, and locale. Do not silently substitute another locale for legal consent.
