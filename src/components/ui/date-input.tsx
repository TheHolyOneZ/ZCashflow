import { useEffect, useMemo, useState } from "react";
import { Popover as P } from "radix-ui";
import { useTranslation } from "react-i18next";
import {
  addDays,
  addMonths,
  format,
  getDay,
  getDaysInMonth,
  isValid,
  parseISO,
  startOfMonth,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeLocale } from "@/lib/i18n";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function DateInput({
  id,
  value,
  onChange,
  min,
  max,
  clearable,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  clearable?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;

  required?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = value && isValid(parseISO(value)) ? parseISO(value) : null;
  const label = selected
    ? new Intl.DateTimeFormat(activeLocale(), { day: "numeric", month: "short", year: "numeric" }).format(selected)
    : (placeholder ?? t("date.pick"));

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <P.Trigger
          id={id}
          aria-label={ariaLabel}
          className={cn(
            "flex h-full min-h-9 w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 text-left whitespace-nowrap",
            "transition-[border-color,box-shadow] duration-150 hover:border-muted/40 focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring",
            "data-[state=open]:border-accent data-[state=open]:ring-2 data-[state=open]:ring-ring active:scale-100",
            clearable && selected && "pr-8",
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted" />
          <span className={cn("tabular min-w-0 truncate", !selected && "text-muted/70")}>{label}</span>
        </P.Trigger>
        {clearable && selected && (
          <button
            type="button"
            aria-label={t("date.clear")}
            onClick={() => onChange("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[300] origin-[var(--radix-popover-content-transform-origin)] rounded-2xl border border-border bg-surface p-3 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.3)] data-[state=open]:animate-[pop-in_160ms_var(--ease-out)]"
        >
          <Calendar
            value={selected}
            min={min}
            max={max}
            onPick={(d) => {
              onChange(iso(d));
              setOpen(false);
            }}
          />
          <div className="mt-2 flex gap-1.5 border-t border-border pt-2">
            {[
              { label: t("common.today"), d: new Date() },
              { label: t("common.yesterday"), d: addDays(new Date(), -1) },
            ].map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  onChange(iso(q.d));
                  setOpen(false);
                }}
                className="rounded-md bg-surface-2 px-2.5 py-1 text-[12px] font-medium hover:bg-accent-soft hover:text-accent"
              >
                {q.label}
              </button>
            ))}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

function Calendar({
  value,
  min,
  max,
  onPick,
}: {
  value: Date | null;
  min?: string;
  max?: string;
  onPick: (d: Date) => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState(() => startOfMonth(value ?? new Date()));
  const [mode, setMode] = useState<"days" | "years">("days");
  useEffect(() => setView(startOfMonth(value ?? new Date())), [value]);

  const loc = activeLocale();
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(loc, { weekday: "narrow" }).format(new Date(2024, 0, 1 + i))),
    [loc],
  );
  const lead = (getDay(view) + 6) % 7;
  const days = getDaysInMonth(view);
  const today = iso(new Date());
  const sel = value ? iso(value) : null;
  const outOfRange = (d: string) => (!!min && d < min) || (!!max && d > max);

  const navBtn =
    "flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

  if (mode === "years") {
    const base = view.getFullYear() - 7;
    return (
      <div className="w-[17.5rem]">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" className={navBtn} aria-label={t("date.prev")} onClick={() => setView(addMonths(view, -12 * 12))}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-[13px] font-semibold">
            {base} – {base + 11}
          </span>
          <button type="button" className={navBtn} aria-label={t("date.next")} onClick={() => setView(addMonths(view, 12 * 12))}>
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => base + i).map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => {
                setView(new Date(y, view.getMonth(), 1));
                setMode("days");
              }}
              className={cn(
                "tabular rounded-lg py-2 text-[13px] hover:bg-surface-2",
                y === view.getFullYear() && "bg-accent font-semibold text-accent-fg hover:bg-accent",
              )}
            >
              {y}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-[17.5rem]">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className={navBtn} aria-label={t("date.prev")} onClick={() => setView(addMonths(view, -1))}>
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setMode("years")}
          className="rounded-lg px-2 py-1 text-[13px] font-semibold capitalize hover:bg-surface-2"
        >
          {new Intl.DateTimeFormat(loc, { month: "long", year: "numeric" }).format(view)}
        </button>
        <button type="button" className={navBtn} aria-label={t("date.next")} onClick={() => setView(addMonths(view, 1))}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdays.map((w, i) => (
          <span key={i} className="py-1 text-[11px] font-medium text-muted">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = new Date(view.getFullYear(), view.getMonth(), i + 1);
          const key = iso(d);
          const disabled = outOfRange(key);
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onPick(d)}
              className={cn(
                "tabular flex aspect-square items-center justify-center rounded-lg text-[13px] hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30",
                key === today && "font-semibold text-accent",
                key === sel && "bg-accent font-semibold text-accent-fg hover:bg-accent",
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
