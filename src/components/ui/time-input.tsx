import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeTime } from "@/lib/time";

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
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  return (
    <div className={cn("relative", className)}>
      <Clock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        inputMode="numeric"
        autoComplete="off"
        placeholder="--:--"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        onBlur={() => {
          const n = normalizeTime(text);
          if (n !== null && n !== text) {
            setText(n);
            onChange(n);
          }
        }}
        className={cn(
          "tabular h-full min-h-9 w-full rounded-lg border border-border bg-surface pr-8 pl-9 text-fg placeholder:text-muted/70",
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
  );
}
