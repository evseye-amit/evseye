"use client";

export type LegalAcceptanceCopy = {
  declarationTitle: string;
  declaration: string;
  checkboxLabel: string;
  continueLabel: string;
};
export const englishConsentAcceptance: LegalAcceptanceCopy = {
  declarationTitle: "Declaration",
  declaration: "I declare that I have understood the points of this consent form and agree in my capacity as the data principal.",
  checkboxLabel: "I have read and understood this consent form and give my consent.",
  continueLabel: "Continue",
};
export function LegalAcceptanceFields({ value, locale, onChange }: {
  value?: LegalAcceptanceCopy | null; locale: string; onChange: (value: LegalAcceptanceCopy) => void;
}) {
  const copy = value ?? (locale === "en" ? englishConsentAcceptance : {
    declarationTitle: "", declaration: "", checkboxLabel: "", continueLabel: "",
  });
  const field = (key: keyof LegalAcceptanceCopy, label: string, multiline = false) => <label key={key}>{label} *
    {multiline ? <textarea required rows={3} maxLength={2000} value={copy[key]} onChange={(event) => onChange({ ...copy, [key]: event.target.value })} />
      : <input required maxLength={2000} value={copy[key]} onChange={(event) => onChange({ ...copy, [key]: event.target.value })} />}
  </label>;
  return <section className="form-stack">
    <h3>Consent declaration and checkbox</h3>
    <p className="muted">Enter this wording in the document language. The in-app acceptance checkbox replaces the paper signature, name and designation lines in the source form. Keep the document body free of paper signature fields; the app displays this declaration beneath it.</p>
    {field("declarationTitle", "Declaration heading")}
    {field("declaration", "Declaration", true)}
    {field("checkboxLabel", "Acceptance checkbox text", true)}
    {field("continueLabel", "Continue button text")}
  </section>;
}
export function LegalAcceptancePreview({ value }: { value?: LegalAcceptanceCopy | null }) {
  if (!value) return null;
  return <section className="form-stack"><h3>{value.declarationTitle}</h3><p>{value.declaration}</p>
    <label><input type="checkbox" disabled /> {value.checkboxLabel}</label><p className="muted">{value.continueLabel} is enabled in the app after acceptance.</p></section>;
}
