import { useEffect, useRef, useState } from "react";
import { Popover as P } from "radix-ui";
import { useTranslation } from "react-i18next";
import { Clock, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { nowTime } from "@/lib/dates";
import { from12, joinTime, normalizeTime, shiftMinutes, showTime, splitTime, to12 } from "@/lib/time";
import { usePrefs } from "@/stores/prefs";

export function TimeInput({
  id,
  value,
  onChange,
  invalid,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const { t } = useTranslation();
  const twelve = usePrefs((s) => s.timeFormat) === "12";
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => showTime(value, twelve));
  useEffect(() => {
    if (!value || document.activeElement !== field.current) setText(showTime(value, twelve));
  }, [value, twelve]);

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Anchor asChild>
        <div className={cn("relative", className)}>
          <P.Trigger
            type="button"
            tabIndex={-1}
            aria-label={t("time.pick")}
            className="absolute top-1/2 left-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg data-[state=open]:text-accent"
          >
            <Clock className="size-4" />
          </P.Trigger>
          <input
            ref={field}
            id={id}
            aria-label={ariaLabel}
            aria-invalid={invalid}
            inputMode={twelve ? "text" : "numeric"}
            autoComplete="off"
            placeholder="--:--"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onChange(e.target.value);
            }}
            onBlur={() => {
              const n = normalizeTime(text);
              if (n === null) return;
              setText(showTime(n, twelve));
              if (n !== value) onChange(n);
            }}
            className={cn(
              "tabular h-full min-h-9 w-full rounded-lg border border-border bg-surface text-fg placeholder:text-muted/70",
              twelve ? "pr-7 pl-8 text-[13px]" : "pr-8 pl-9",
              "transition-[border-color,box-shadow] duration-150 hover:border-muted/40 focus:border-accent focus:ring-2 focus:ring-ring focus:outline-none",
              invalid && "border-expense focus:border-expense",
            )}
          />
          {text && (
            <button
              type="button"
              aria-label={t("common.clear")}
              onClick={() => {
                setText("");
                onChange("");
              }}
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </P.Anchor>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onKeyDown={(e) => e.key === "Enter" && e.stopPropagation()}
          className="z-[300] w-[17rem] max-w-[calc(100vw-1.5rem)] origin-[var(--radix-popover-content-transform-origin)] rounded-2xl border border-border bg-surface p-3 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.3)] data-[state=open]:animate-[pop-in_160ms_var(--ease-out)]"
        >
          <TimeGrid value={value} twelve={twelve} onChange={onChange} onDone={() => setOpen(false)} />
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

const cell = "tabular flex h-8 items-center justify-center rounded-md text-[13px] font-medium transition-colors active:scale-100";
const cellState = (on: boolean) => (on ? "bg-accent text-accent-fg" : "bg-surface-2 hover:bg-accent-soft hover:text-accent");

function TimeGrid({ value, twelve, onChange, onDone }: { value: string; twelve: boolean; onChange: (v: string) => void; onDone: () => void }) {
  const { t } = useTranslation();
  const now = splitTime(value);
  const { h, m } = now ?? { h: -1, m: -1 };
  const half = now ? to12(h) : null;
  const pm = half?.pm ?? false;
  const hours = twelve ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);
  const setHour = (v: number) => onChange(joinTime(twelve ? from12(v, pm) : v, Math.max(m, 0)));

  return (
    <div className="flex flex-col gap-2">
      <div className="tabular text-center text-[19px] font-semibold">{now ? showTime(joinTime(h, m), twelve) : "--:--"}</div>
      <div className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-muted">{t("time.hour")}</span>
        <div className="grid grid-cols-6 gap-1">
          {hours.map((v) => (
            <button key={v} type="button" onClick={() => setHour(v)} className={cn(cell, cellState(twelve ? half?.hour === v : h === v))}>
              {twelve ? v : String(v).padStart(2, "0")}
            </button>
          ))}
        </div>
        {twelve && (
          <div className="grid grid-cols-2 gap-1">
            {[false, true].map((p) => (
              <button
                key={String(p)}
                type="button"
                onClick={() => onChange(joinTime(from12(half?.hour ?? 12, p), Math.max(m, 0)))}
                className={cn(cell, cellState(!!half && pm === p))}
              >
                {p ? "PM" : "AM"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] font-medium text-muted">{t("time.minute")}</span>
          <div className="flex gap-1">
            {[-1, 1].map((by) => (
              <button
                key={by}
                type="button"
                aria-label={by < 0 ? t("time.minuteLess") : t("time.minuteMore")}
                onClick={() => onChange(shiftMinutes(value, by))}
                className="flex size-7 items-center justify-center rounded-md bg-surface-2 hover:bg-accent-soft hover:text-accent"
              >
                {by < 0 ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {minutes.map((v) => (
            <button key={v} type="button" onClick={() => onChange(joinTime(Math.max(h, 0), v))} className={cn(cell, cellState(m === v))}>
              {String(v).padStart(2, "0")}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-between gap-1.5 border-t border-border pt-2">
        <button type="button" onClick={() => onChange(nowTime())} className="rounded-md bg-surface-2 px-2.5 py-1 text-[12px] font-medium hover:bg-accent-soft hover:text-accent">
          {t("time.now")}
        </button>
        <button type="button" onClick={onDone} className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-accent-fg">
          {t("time.done")}
        </button>
      </div>
    </div>
  );
}
