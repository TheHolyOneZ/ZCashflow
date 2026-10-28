import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover as P, Tooltip as T } from "radix-ui";
import { Minus, Plus, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { Input } from "./field";

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 999,
  "aria-label": ariaLabel,
  className,
  prefix,
  suffix,
}: {
  prefix?: string;
  suffix?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  "aria-label"?: string;
  className?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Number.isFinite(v) ? Math.round(v) : min));
  const btn =
    "flex w-8 items-center justify-center text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className={cn("flex h-9 overflow-hidden rounded-lg border border-border bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-ring", className)}>
      <button type="button" tabIndex={-1} className={btn} disabled={value <= min} onClick={() => onChange(clamp(value - 1))} aria-label="−">
        <Minus className="size-3.5" />
      </button>
      <label className="flex min-w-0 flex-1 items-center justify-center gap-1 text-[13px]">
      {prefix && <span className="text-muted">{prefix}</span>}
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, "")) || min))}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") onChange(clamp(value + 1));
          if (e.key === "ArrowDown") onChange(clamp(value - 1));
        }}
        style={prefix || suffix ? { width: `${String(value).length + 0.4}ch` } : undefined}
        className={prefix || suffix ? "tabular min-w-0 bg-transparent text-right font-medium outline-none" : "tabular w-10 min-w-0 flex-1 bg-transparent text-center outline-none"}
      />
      {suffix && <span className="-ml-1 font-medium">{suffix}</span>}
      </label>
      <button type="button" tabIndex={-1} className={btn} disabled={value >= max} onClick={() => onChange(clamp(value + 1))} aria-label="+">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <Input
        type="text"
        role="searchbox"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && (e.stopPropagation(), onChange(""))}
        className="px-9"
      />
      {value && (
        <button
          type="button"
          aria-label={t("common.clear")}
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Autocomplete({
  id,
  value,
  onChange,
  onBlur,
  onPick,
  suggestions,
  placeholder,
  renderIcon,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
  onPick?: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  renderIcon?: (s: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = suggestions.filter((s) => s.toLowerCase() !== q);
    const starts = list.filter((s) => s.toLowerCase().startsWith(q));
    const contains = q ? list.filter((s) => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q)) : [];
    return [...starts, ...contains].slice(0, 8);
  }, [value, suggestions]);
  const show = open && matches.length > 0;

  const pick = (s: string) => {
    onChange(s);
    setOpen(false);
    onBlur?.(s);
    onPick?.(s);
  };
  const q = value.trim();

  return (
    <P.Root open={show} onOpenChange={setOpen}>
      <P.Anchor asChild>
        <div>
          <Input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={show}
            aria-controls={listId}
            autoComplete="off"
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={(e) => {
              setTimeout(() => setOpen(false), 120);
              onBlur?.(e.target.value);
            }}
            onKeyDown={(e) => {
              if (!show) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (a + 1) % matches.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a - 1 + matches.length) % matches.length);
              } else if (e.key === "Enter" || e.key === "Tab") {
                if (matches[active]) {
                  e.preventDefault();
                  pick(matches[active]);
                }
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </div>
      </P.Anchor>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-[300] w-[var(--radix-popover-trigger-width)] min-w-56 rounded-xl border border-border bg-surface p-1 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.25)] data-[state=open]:animate-[pop-in_120ms_var(--ease-out)]"
        >
          <ul id={listId} role="listbox">
            {matches.map((s, i) => (
              <li
                key={s}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px]",
                  i === active && "bg-surface-2",
                )}
              >
                {renderIcon?.(s)}
                <span className="truncate">
                  <Highlight text={s} query={q} />
                </span>
              </li>
            ))}
          </ul>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-accent">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  );
}

export function Tip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-[320] rounded-md bg-fg px-2 py-1 text-[12px] font-medium text-bg shadow-lg data-[state=delayed-open]:animate-[pop-in_120ms_var(--ease-out)]"
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TooltipProvider = T.Provider;
