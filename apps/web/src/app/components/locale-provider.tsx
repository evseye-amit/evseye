"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { LOCALE_COOKIE, supportedLocale, translate, type Locale } from "../../lib/i18n";

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (source: string) => string };
const LocaleContext = createContext<LocaleContextValue>({ locale: "en", setLocale: () => {}, t: (source) => source });

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  function setLocale(next: Locale) {
    const selected = supportedLocale(next);
    document.cookie = `${LOCALE_COOKIE}=${selected}; Path=/; Max-Age=31536000; SameSite=Lax`;
    updateLocale(selected);
  }
  return <LocaleContext.Provider value={{ locale, setLocale, t: (source) => translate(locale, source) }}>{children}</LocaleContext.Provider>;
}

export function useLocale() { return useContext(LocaleContext); }
export function LocalizedText({ text }: { text: string }) {
  const { t } = useLocale();
  return <>{t(text)}</>;
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return <label className="language-switcher"><span>{t("Language")}</span><select aria-label={t("Language")} value={locale} onChange={(event) => setLocale(supportedLocale(event.target.value))}><option value="en">English</option><option value="hi">हिन्दी</option><option value="te">తెలుగు</option><option value="kn">ಕನ್ನಡ</option></select></label>;
}
