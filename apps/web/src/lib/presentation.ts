// Display helpers only: API values and date-filter boundaries stay unchanged.
export function formatDateTime(value?: string | Date | null, locale = "en-IN") {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(locale);
}

export function formatMoney(value: string | number, currency = "INR", locale = "en-IN") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount); }
  catch { return `${currency} ${new Intl.NumberFormat(locale).format(amount)}`; }
}
