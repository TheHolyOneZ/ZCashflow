import { create } from "zustand";
import { usePrefs } from "@/stores/prefs";

export const useMoneyDisplay = create<{ single: boolean }>(() => ({ single: false }));

export function currencyHidden() {
  return useMoneyDisplay.getState().single && usePrefs.getState().currencySymbol === "single";
}

export function useCurrencyHidden() {
  const single = useMoneyDisplay((s) => s.single);
  const pref = usePrefs((s) => s.currencySymbol);
  return single && pref === "single";
}

export function useExpensesInRed() {
  return usePrefs((s) => s.expenseStyle === "red");
}

export function dropCurrency(parts: Intl.NumberFormatPart[]): Intl.NumberFormatPart[] {
  const gone = new Set<number>();
  const blank = (i: number) => parts[i]?.type === "literal" && !parts[i].value.trim();
  parts.forEach((p, i) => {
    if (p.type !== "currency") return;
    gone.add(i);
    if (blank(i + 1)) gone.add(i + 1);
    else if (blank(i - 1)) gone.add(i - 1);
  });
  return parts.filter((_, i) => !gone.has(i));
}

export function withCurrencyChoice(parts: Intl.NumberFormatPart[]): string {
  return (currencyHidden() ? dropCurrency(parts) : parts).map((p) => p.value).join("");
}

export function joinParts(parts: Intl.NumberFormatPart[]): string {
  const shown = currencyHidden() ? dropCurrency(parts) : parts;
  return moneyHidden() ? maskParts(shown) : shown.map((p) => p.value).join("");
}

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
  return joinParts(f.formatToParts(value));
}

export function parseMoney(input: string, currency = "EUR", allowZero = false): number | null {
  const digits = minorDigits(currency);
  const s = input.trim().replace(/[\s€$£'’]|EUR|USD|CHF/gi, "");
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

function separators(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  return {
    group: parts.find((p) => p.type === "group")?.value ?? ",",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
  };
}

export function groupAmount(text: string, currency: string, locale: string): string {
  const neg = text.startsWith("-");
  const body = (neg ? text.slice(1) : text).replace(/[\s'’]/g, "");
  if (!/^\d[\d.,]*$/.test(body)) return text;
  const digits = minorDigits(currency);
  const last = Math.max(body.lastIndexOf("."), body.lastIndexOf(","));
  const fracLen = last === -1 ? 0 : body.length - last - 1;
  const decimalAt = last !== -1 && digits > 0 && fracLen <= digits && (fracLen >= 1 || last === body.length - 1);
  const intPart = (decimalAt ? body.slice(0, last) : body).replace(/[.,]/g, "");
  const { group, decimal } = separators(locale);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return (neg ? "-" : "") + grouped + (decimalAt ? decimal + body.slice(last + 1) : "");
}

export function ungroupAmount(raw: string, caret: number, change: "typed" | "deleted" | "pasted", currency: string, locale: string) {
  const { group, decimal } = separators(locale);
  const digits = minorDigits(currency);
  const marks = [".", ","];
  let at = raw.lastIndexOf(decimal);
  if (at < 0 && change === "typed" && marks.includes(raw[caret - 1])) at = caret - 1;
  if (at < 0) for (const c of marks) if (c !== group) at = Math.max(at, raw.lastIndexOf(c));
  if (at < 0 && change === "pasted") {
    const last = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
    const frac = raw.slice(last + 1).replace(/\D/g, "").length;
    if (last >= 0 && frac >= 1 && frac <= digits && frac !== 3) at = last;
  }
  if (digits === 0) at = -1;
  let text = raw.trimStart().startsWith("-") ? "-" : "";
  let pos = -1;
  let fracCount = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i === caret) pos = text.length;
    const c = raw[i];
    if (c >= "0" && c <= "9") {
      if (at >= 0 && i > at) {
        if (fracCount >= digits) continue;
        fracCount++;
      }
      text += c;
    } else if (i === at && digits > 0) {
      text += decimal;
    }
  }
  return { text, caret: pos < 0 ? text.length : pos };
}

export function groupedInput(el: HTMLInputElement, shown: string, currency: string, locale: string): string {
  const raw = el.value;
  const caret = el.selectionStart ?? raw.length;
  const change = raw.length === shown.length + 1 ? "typed" : raw.length < shown.length ? "deleted" : "pasted";
  const { text, caret: at } = ungroupAmount(raw, caret, change, currency, locale);
  const next = groupAmount(text, currency, locale);
  const { group } = separators(locale);
  let pos = 0;
  for (let seen = 0; pos < next.length && seen < at; pos++) if (next[pos] !== group) seen++;
  requestAnimationFrame(() => {
    if (document.activeElement === el && el.value === next) el.setSelectionRange(pos, pos);
  });
  return text;
}

export function amountTextClass(text: string, size: "2xl" | "xl"): string {
  const n = text.length;
  if (size === "2xl") return n > 24 ? "text-base" : n > 21 ? "text-lg" : n > 17 ? "text-xl" : "text-2xl";
  const phone = n > 21 ? "text-xs" : n > 17 ? "text-sm" : n > 14 ? "text-base" : "text-xl";
  const wide = n > 25 ? "sm:text-sm" : n > 20 ? "sm:text-base" : "sm:text-xl";
  return `${phone} ${wide}`;
}

export function minorToInput(minor: number, currency: string, locale: string): string {
  const digits = minorDigits(currency);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(minor / 10 ** digits);
}
