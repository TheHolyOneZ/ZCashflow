const FALLBACK = [
  "AED", "ARS", "AUD", "BDT", "BGN", "BHD", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CZK", "DKK", "EGP", "EUR", "GBP",
  "GHS", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JOD", "JPY", "KES", "KRW", "KWD", "LKR", "MAD", "MXN", "MYR", "NGN",
  "NOK", "NPR", "NZD", "OMR", "PEN", "PHP", "PKR", "PLN", "QAR", "RON", "RSD", "SAR", "SEK", "SGD", "THB", "TND", "TRY",
  "TWD", "UAH", "USD", "VND", "ZAR",
];

let cached: string[] | null = null;

export function currencyCodes(): string[] {
  if (cached) return cached;
  let codes: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    codes = intl.supportedValuesOf?.("currency") ?? [];
  } catch {
    codes = [];
  }
  cached = [...new Set([...codes, ...FALLBACK])].filter((c) => /^[A-Z]{3}$/.test(c)).sort();
  return cached;
}

export function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function currencyItems(locale: string, keep?: string) {
  const codes = currencyCodes();
  const all = keep && !codes.includes(keep) ? [...codes, keep] : codes;
  return all.map((c) => ({ value: c, label: `${c} – ${currencyName(c, locale)}` }));
}
