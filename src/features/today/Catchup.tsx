import { useState } from "react";
import { useTranslation } from "react-i18next";
import { addDays, addMonths, differenceInCalendarDays, parseISO, startOfMonth } from "date-fns";
import { CalendarRange, History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { formatDay, isoDate } from "@/lib/dates";

const KEY = "zc.catchup";

function readFrom(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function useCatchup() {
  const [from, setFrom] = useState(readFrom);
  const start = (d: string) => {
    try {
      localStorage.setItem(KEY, d);
    } catch {
      void 0;
    }
    setFrom(d);
  };
  const stop = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      void 0;
    }
    setFrom(null);
  };
  return { from, start, stop };
}

export function daysBetween(from: string, to: string): string[] {
  const n = differenceInCalendarDays(parseISO(to), parseISO(from));
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => isoDate(addDays(parseISO(from), i)));
}

export function CatchupStart({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStart: (from: string) => void;
}) {
  const { t } = useTranslation();
  const today = isoDate();
  const [custom, setCustom] = useState("");
  const presets = [1, 2, 3, 4, 6].map((months) => {
    const from = isoDate(startOfMonth(addMonths(parseISO(today), -(months - 1))));
    return { months, from, days: differenceInCalendarDays(parseISO(today), parseISO(from)) + 1 };
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("catchup.title")} description={t("catchup.intro")}>
      <div className="flex flex-col gap-2">
        {presets.map((p) => (
          <button
            key={p.months}
            type="button"
            onClick={() => onStart(p.from)}
            className="group flex items-center gap-3 rounded-xl border border-border px-3.5 py-3 text-left transition-colors hover:border-accent/60 hover:bg-accent-soft"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent group-hover:bg-surface">
              <CalendarRange className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">
                {p.months === 1 ? t("catchup.thisMonth") : t("catchup.months", { count: p.months })}
              </span>
              <span className="block text-[12px] text-muted">
                {t("catchup.since", { date: formatDay(p.from, { day: "numeric", month: "long", year: "numeric" }) })} ·{" "}
                {t("catchup.days", { count: p.days })}
              </span>
            </span>
          </button>
        ))}
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-border px-3.5 py-2.5">
          <span className="text-[13px] text-muted">{t("catchup.custom")}</span>
          <DateInput value={custom} onChange={setCustom} max={today} className="ml-auto w-44" aria-label={t("catchup.custom")} />
          <Button variant="primary" size="sm" disabled={!custom || custom > today} onClick={() => onStart(custom)}>
            {t("catchup.go")}
          </Button>
        </div>
        <p className="pt-1 text-[12px] text-muted">{t("catchup.tip")}</p>
      </div>
    </Dialog>
  );
}

export function CatchupBanner({
  from,
  day,
  done,
  onStop,
  onResume,
}: {
  from: string;
  day: string;
  done: Set<string>;
  onStop: () => void;
  onResume: () => void;
}) {
  const { t } = useTranslation();
  const range = daysBetween(from, isoDate());
  const finished = range.filter((d) => done.has(d)).length;
  const index = range.indexOf(day);
  const pct = range.length ? Math.round((finished / range.length) * 100) : 0;
  return (
    <Card className="overflow-hidden border-accent/40">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <History className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">
            {index >= 0 ? t("catchup.banner", { n: index + 1, total: range.length }) : t("catchup.outside")}
          </div>
          <div className="truncate text-[12px] text-muted">
            {t("catchup.bannerHint", { done: finished, total: range.length })}
          </div>
        </div>
        {index < 0 && (
          <Button size="sm" variant="primary" onClick={onResume}>
            {t("catchup.resume")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onStop} aria-label={t("catchup.stop")}>
          <X className="size-4" />
          <span className="hidden sm:inline">{t("catchup.stop")}</span>
        </Button>
      </div>
      <div className="h-1.5 bg-surface-2">
        <div
          className={cn("h-full bg-accent transition-[width] duration-500 ease-[var(--ease-out)]")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </Card>
  );
}
