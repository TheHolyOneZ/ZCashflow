import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { activeLocale } from "@/lib/i18n";
import { usePrefs } from "@/stores/prefs";

export function isoDate(d: Date = new Date()): string {
  return format(d, "yyyy-MM-dd");
}

export function monthRange(d: Date = new Date()) {
  return { from: isoDate(startOfMonth(d)), to: isoDate(endOfMonth(d)) };
}

export function formatDay(iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(activeLocale(), opts).format(parseISO(iso));
}

export function monthLabel(d: Date, locale: string = activeLocale()): string {
  const text = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(d);
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export function nowTime(d: Date = new Date()): string {
  return format(d, "HH:mm");
}

export function entryTime(day: string): string | null {
  return day === isoDate() ? nowTime() : null;
}

export function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const twelve = usePrefs.getState().timeFormat === "12";
  const options: Intl.DateTimeFormatOptions = twelve
    ? { hour: "numeric", minute: "2-digit", hour12: true }
    : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  return new Intl.DateTimeFormat(activeLocale(), options).format(new Date(2000, 0, 1, h, m));
}
