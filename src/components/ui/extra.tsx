import { useState, type ReactNode } from "react";
import { Switch as RSwitch } from "radix-ui";
import { Check, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { activeLocale } from "@/lib/i18n";
import { minorDigits, minorToInput, parseMoney } from "@/lib/money";
import { Button } from "./button";
import { Input } from "./field";

export function Money({
  minor,
  currency,
  signed,
  tone,
  className,
  fractionClassName = "opacity-55",
}: {
  minor: number;
  currency: string;
  signed?: boolean;

  tone?: "auto" | "none";
  className?: string;
  fractionClassName?: string;
}) {
  useTranslation();
  const digits = minorDigits(currency);
  const parts = new Intl.NumberFormat(activeLocale(), {
    style: "currency",
    currency,
    signDisplay: signed ? "exceptZero" : "auto",
  }).formatToParts(minor / 10 ** digits);
  const color =
    tone === "auto" ? (minor < 0 ? "text-expense" : signed && minor > 0 ? "text-income" : undefined) : undefined;
  return (
    <span className={cn("money tabular whitespace-nowrap", color, className)}>
      {parts.map((p, i) =>
        p.type === "fraction" || (p.type === "decimal" && parts[i + 1]?.type === "fraction") ? (
          <span key={i} className={fractionClassName}>
            {p.value}
          </span>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </span>
  );
}

export function MoneyInput({
  id,
  value,
  onChange,
  currency,
  invalid,
  autoFocus,
  className,
  placeholder,
  allowNegative,
}: {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  currency: string;
  invalid?: boolean;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
  allowNegative?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        autoFocus={autoFocus}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder ?? minorToInput(0, currency, activeLocale())}
        value={value}
        aria-invalid={invalid}
        onChange={(e) =>
          onChange(allowNegative ? e.target.value : e.target.value.replace(/^-/, ""))
        }
        className={cn("tabular pr-12 font-medium", invalid && "border-expense focus:border-expense", className)}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] font-medium text-muted">
        {currency}
      </span>
    </div>
  );
}

export function parseSignedMoney(text: string, currency: string): number | null {
  const neg = text.trim().startsWith("-");
  const v = parseMoney(text.trim().replace(/^-/, ""), currency, true);
  return v === null ? null : neg ? -v : v;
}

export function ProgressBar({
  value,
  color,
  className,
  tone,
}: {
  value: number;
  color?: string;
  className?: string;
  tone?: "ok" | "warn" | "over";
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const bg =
    color ?? (tone === "over" ? "var(--expense)" : tone === "warn" ? "var(--warn)" : "var(--accent)");
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 overflow-hidden rounded-full bg-fg/8", className)}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out)]"
        style={{ width: `${pct}%`, backgroundColor: bg }}
      />
    </div>
  );
}

export function ProgressRing({
  value,
  size = 56,
  stroke = 5,
  color = "var(--accent)",
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in srgb, var(--fg) 9%, transparent)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          className="transition-[stroke-dashoffset] duration-700 ease-[var(--ease-out)]"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  id,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={ariaLabel}
      className="relative h-5 w-9 shrink-0 rounded-full bg-border transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=checked]:bg-accent"
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-[var(--ease-out)] data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] text-muted">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

export const SWATCHES = [
  "#0f766e", "#16a34a", "#65a30d", "#ca8a04", "#ea580c", "#dc2626",
  "#db2777", "#9333ea", "#7c3aed", "#4f46e5", "#2563eb", "#0891b2", "#64748b",
];

export function ColorSwatches({ value, onChange }: { value: string | null; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className="flex size-7 items-center justify-center rounded-full transition-transform duration-150 ease-[var(--ease-out)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-90"
          style={{ backgroundColor: c }}
        >
          {value === c && <Check className="size-3.5 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

export function ConfirmDeleteButton({
  onConfirm,
  label,
  confirmLabel,
  disabled,
}: {
  onConfirm: () => void;
  label?: string;
  confirmLabel?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant={armed ? "danger" : "ghost"}
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      <Trash2 className="size-4" />
      {armed ? (confirmLabel ?? t("common.confirmDelete")) : (label ?? t("common.delete"))}
    </Button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "income" | "expense" | "warn";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    accent: "bg-accent-soft text-accent",
    income: "bg-income/12 text-income",
    expense: "bg-expense/12 text-expense",
    warn: "bg-warn/15 text-warn",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function FormFooter({
  onCancel,
  saving,
  saveDisabled,
  left,
}: {
  onCancel: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  left?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 pt-2">
      {left}
      <div className="ml-auto flex gap-2">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={saving || saveDisabled}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
