export type ApiLocale = 'en' | 'hi' | 'te' | 'kn';

const supported = new Set<ApiLocale>(['en', 'hi', 'te', 'kn']);

/** Negotiates a mobile request's language without trusting a client-supplied package or locale in the body. */
export function requestLocale(header: string | string[] | undefined): ApiLocale {
  const source = Array.isArray(header) ? header.join(',') : header ?? '';
  const preferences = source.split(',').map((part) => {
    const [tag, ...parameters] = part.trim().split(';');
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    return { locale: tag?.toLowerCase().split('-')[0] as ApiLocale, q: Number.isFinite(q) ? q : 0 };
  }).filter((item) => item.q > 0).sort((left, right) => right.q - left.q);
  return preferences.find((item) => supported.has(item.locale))?.locale ?? 'en';
}

type Translation = Record<string, unknown>;

export function translatedProperty(
  fallback: string | null | undefined,
  translations: unknown,
  locale: ApiLocale,
  property: string,
): string | null | undefined {
  if (locale === 'en' || !translations || typeof translations !== 'object' || Array.isArray(translations)) return fallback;
  const value = (translations as Translation)[locale];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const translated = (value as Translation)[property];
  return typeof translated === 'string' && translated.trim() ? translated : fallback;
}
