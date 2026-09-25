# Rider and Fleet Manager API languages

Mobile clients can send `Accept-Language: en-IN`, `hi-IN`, `te-IN`, or `kn-IN` on every request, including OTP and onboarding requests. A plain two-letter code also works. If omitted or unsupported, the API uses English. Responses include `Content-Language`; the API varies responses by `Accept-Language`.

The Rider onboarding API localizes step names, step descriptions, field names, labels, and configured placeholders. Admins can provide translations in the existing Feature or Package Feature `configuration` JSON:

```json
{
  "translations": {
    "hi": { "name": "पूरा नाम", "label": "पूरा नाम", "description": "राइडर का नाम दर्ज करें" },
    "te": { "name": "పూర్తి పేరు", "label": "పూర్తి పేరు", "description": "రైడర్ పేరు నమోదు చేయండి" },
    "kn": { "name": "ಪೂರ್ಣ ಹೆಸರು", "label": "ಪೂರ್ಣ ಹೆಸರು", "description": "ರೈಡರ್ ಹೆಸರು ದಾಖಲಿಸಿ" }
  }
}
```

Package Feature translations take precedence over Feature translations. The existing Rider catalog has built-in translations for field names and labels. Feature Steps have a `translations` object with the same language keys and `displayName` and `description` properties. Rider training content supports `translations.{locale}.title` and `.description` through its admin create/update API.

The API also localizes known validation and workflow error messages. Untranslated custom copy falls back to English. User-entered names, remarks, document names, and Work Partner names are returned as entered.

`fieldCode`, `featureCode`, step codes, payment and workflow statuses, enum values, validation keys, and monetary values stay language-independent. Mobile apps should use those codes for control flow and their own localized labels for status badges. Do not parse translated messages for business decisions.

After login, Rider and Fleet Manager apps can call `GET /api/v1/mobile-deployments/localization` with the same language header. It returns localized labels keyed by stable Rider screen, deployment, payment, Fleet, and IoT status codes.
