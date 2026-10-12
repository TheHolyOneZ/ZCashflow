import type { TFunction } from "i18next";
import { parseISO } from "date-fns";
import type { Freq } from "@/lib/api";
import { activeLocale } from "@/lib/i18n";
import { isoDate } from "@/lib/dates";

export function freqLabel(t: TFunction, freq: Freq, interval: number): string {
  return interval <= 1 ? t(`freq.${freq}`) : t(`freq.every_${freq}`, { count: interval });
}

export function relativeDays(days: number): string {
  return new Intl.RelativeTimeFormat(activeLocale(), { numeric: "auto" }).format(days, "day");
}

export function daysFromToday(iso: string): number {
  const ms = parseISO(iso).getTime() - parseISO(isoDate()).getTime();
  return Math.round(ms / 86_400_000);
}

export function monthLabel(yyyymm: string, opts: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }) {
  return new Intl.DateTimeFormat(activeLocale(), opts).format(parseISO(`${yyyymm}-01`));
}

export function shortDate(iso: string) {
  return new Intl.DateTimeFormat(activeLocale(), { day: "numeric", month: "short" }).format(parseISO(iso));
}

export function percent(v: number) {
  return new Intl.NumberFormat(activeLocale(), { style: "percent", maximumFractionDigits: 0 }).format(v);
}
