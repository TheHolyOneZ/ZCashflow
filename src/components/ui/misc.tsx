import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatMoney, useCurrencyHidden, useExpensesInRed } from "@/lib/money";
import { activeLocale } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import type { TxKind } from "@/lib/api";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface", className)} {...props} />
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
      <h2 className="text-[13px] font-semibold text-muted">{title}</h2>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] text-muted">
      {children}
    </kbd>
  );
}

const kindColor: Record<TxKind, string> = {
  income: "text-income",
  expense: "text-fg",
  transfer: "text-transfer",
};

export function Amount({
  minor,
  currency,
  kind,
  className,
}: {
  minor: number;
  currency: string;
  kind?: TxKind;
  className?: string;
}) {
  useTranslation();
  useCurrencyHidden();
  const red = useExpensesInRed() && kind === "expense";
  const signed = kind === "income" ? minor : kind === "expense" && !red ? -minor : minor;
  return (
    <span
      className={cn(
        "money tabular font-medium whitespace-nowrap",
        red ? "text-expense" : kind ? kindColor[kind] : signed < 0 ? "text-expense" : "text-fg",
        className,
      )}
    >
      {formatMoney(signed, currency, activeLocale(), { signed: kind === "income" })}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 pb-4 sm:items-end">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, hint, icon }: { title: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="text-muted/60">{icon}</div>}
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-[13px] text-muted">{hint}</p>}
    </div>
  );
}
