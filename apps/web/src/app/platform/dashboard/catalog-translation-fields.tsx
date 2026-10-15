"use client";

import { useState } from "react";

export type CatalogTranslation = {
  name?: string | null;
  displayName?: string | null;
  description?: string | null;
  label?: string | null;
  placeholder?: string | null;
  translationStatus?: "DRAFT" | "ACTIVE";
};
export type CatalogTranslations = Record<string, CatalogTranslation>;
type Field = "name" | "displayName" | "description" | "label" | "placeholder";

export const indianLanguages = [
  { code: "as", name: "Assamese", nativeName: "অসমীয়া" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം" },
  { code: "mr", name: "Marathi", nativeName: "मराठी" },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ" },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు" },
  { code: "ur", name: "Urdu", nativeName: "اردو" },
] as const;

export function completeCatalogTranslations(
  base: Partial<Record<Field, string>>,
  fields: readonly Field[],
  existing: CatalogTranslations,
): CatalogTranslations {
  const result = { ...existing };
  for (const { code } of indianLanguages) {
    if (result[code]) continue;
    result[code] = Object.fromEntries([
      ...fields.map((field) => [field, base[field] || null]),
      ["translationStatus", "DRAFT"],
    ]) as CatalogTranslation;
  }
  return result;
}

export function CatalogTranslationFields({ base, fields, translations, onChange }: {
  base: Partial<Record<Field, string>>;
  fields: readonly { key: Field; label: string }[];
  translations: CatalogTranslations;
  onChange: (next: CatalogTranslations) => void;
}) {
  const [locale, setLocale] = useState<string>("hi");
  const selected = indianLanguages.find((language) => language.code === locale)!;
  const values = translations[locale] ?? {};
  return <section className="sa-catalog-translations" aria-label="Translations">
    <div className="sa-catalog-translations-head">
      <div><h3>Language content</h3><p>Edit one language at a time. The English fields above remain the source.</p></div>
      <label>Language
        <select value={locale} onChange={(event) => setLocale(event.target.value)}>
          {indianLanguages.map((language) => <option key={language.code} value={language.code}>
            {language.name} · {language.nativeName}
          </option>)}
        </select>
      </label>
    </div>
    <div lang={locale} dir={locale === "ur" ? "rtl" : "ltr"} className="sa-catalog-translations-grid">
      {fields.map(({ key, label }) => <label key={key}>
        {label} · {selected.name}
        {key === "description" ? <textarea value={values[key] ?? base[key] ?? ""} onChange={(event) => onChange({
          ...translations,
          [locale]: { ...Object.fromEntries(fields.map((field) => [field.key, values[field.key] ?? base[field.key] ?? null])), ...values, [key]: event.target.value, translationStatus: "DRAFT" },
        })} /> : <input value={values[key] ?? base[key] ?? ""} onChange={(event) => onChange({
          ...translations,
          [locale]: { ...Object.fromEntries(fields.map((field) => [field.key, values[field.key] ?? base[field.key] ?? null])), ...values, [key]: event.target.value, translationStatus: "DRAFT" },
        })} />}
      </label>)}
      <label>Translation status · {selected.name}
        <select value={values.translationStatus ?? "DRAFT"} onChange={(event) => onChange({
          ...translations,
          [locale]: {
            ...Object.fromEntries(fields.map((field) => [field.key, values[field.key] ?? base[field.key] ?? null])),
            ...values,
            translationStatus: event.target.value as "DRAFT" | "ACTIVE",
          },
        })}>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
        </select>
      </label>
    </div>
    <p className="sa-catalog-translations-note">Edits return a translation to draft. Set it to Active after reviewing the wording.</p>
  </section>;
}
