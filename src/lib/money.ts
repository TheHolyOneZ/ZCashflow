import { usePrefs } from "@/stores/prefs";

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: string, signDisplay: "auto" | "always") {
  const key = `${locale}|${currency}|${signDisplay}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency, signDisplay });
    formatters.set(key, f);
  }
  return f;
}

export function minorDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

export function moneyHidden() {
  return usePrefs.getState().privacy;
}

export function maskParts(parts: Intl.NumberFormatPart[]): string {
  let masked = false;
  return parts
    .map((p) => {
      if (p.type === "integer" || p.type === "group") {
        if (masked) return "";
        masked = true;
        return "•••";
      }
      if (p.type === "fraction") return "••";
      if (p.type === "compact") return "";
      return p.value;
    })
    .join("");
}

export function formatMoney(
  minor: number,
  currency: string,
  locale: string,
  opts: { signed?: boolean } = {},
): string {
  const value = minor / 10 ** minorDigits(currency);
  const f = formatter(locale, currency, opts.signed ? "always" : "auto");
  return moneyHidden() ? maskParts(f.formatToParts(value)) : f.format(value);
}

export function parseMoney(input: string, currency = "EUR", allowZero = false): number | null {
  const digits = minorDigits(currency);
  const s = input.trim().replace(/[\s€$£]|EUR|USD|CHF/gi, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  const fracLen = last === -1 ? 0 : s.length - last - 1;
  let intPart = s;
  let fracPart = "";
  if (last !== -1 && fracLen >= 1 && fracLen <= digits) {
    intPart = s.slice(0, last);
    fracPart = s.slice(last + 1);
  }
  const int = Number(intPart.replace(/[.,]/g, ""));
  const frac = Number(fracPart.padEnd(digits, "0") || "0");
  const minor = int * 10 ** digits + frac;
  return Number.isSafeInteger(minor) && (allowZero ? minor >= 0 : minor > 0) ? minor : null;
}

export function minorToInput(minor: number, currency: string, locale: string): string {
  const digits = minorDigits(currency);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(minor / 10 ** digits);
}
