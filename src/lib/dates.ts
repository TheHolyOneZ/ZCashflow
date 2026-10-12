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
