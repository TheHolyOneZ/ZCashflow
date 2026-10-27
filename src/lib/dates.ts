import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { activeLocale } from "@/lib/i18n";

export function isoDate(d: Date = new Date()): string {
  return format(d, "yyyy-MM-dd");
}

export function monthRange(d: Date = new Date()) {
  return { from: isoDate(startOfMonth(d)), to: isoDate(endOfMonth(d)) };
}

export function formatDay(iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(activeLocale(), opts).format(parseISO(iso));
}

export function nowTime(d: Date = new Date()): string {
  return format(d, "HH:mm");
}

export function entryTime(day: string): string | null {
  return day === isoDate() ? nowTime() : null;
}

export function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(activeLocale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}
