import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Popover as P } from "radix-ui";
import { ChevronDown, Layers } from "lucide-react";
import { AccountLinesChart, ForecastChart, type LineSeries } from "@/components/charts";
import { Segmented } from "@/components/ui/segmented";
import type { Account, Forecast, ForecastDay, Occurrence } from "@/lib/api";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/i18n";
import { useAccounts } from "@/lib/queries";
import { usePrefs } from "@/stores/prefs";
import { CheckRow } from "@/features/data/CheckRow";

const PALETTE = ["#0f766e", "#2563eb", "#db2777", "#ca8a04", "#7c3aed", "#ea580c", "#16a34a", "#0891b2", "#dc2626", "#64748b"];

function accountColor(a: Account, all: Account[]) {
  return a.color ?? PALETTE[Math.max(0, all.indexOf(a)) % PALETTE.length];
}

export interface ForecastView {
  split: boolean;
  allSelected: boolean;
  days: ForecastDay[];
  events: Occurrence[];
  lines: LineSeries[];
  start: number;
  end: number;
  min: number;
  minOn: string;
}

export function useForecastView(forecast: Forecast | undefined): ForecastView | null {
  const accounts = useAccounts().data ?? [];
  const chosen = usePrefs((s) => s.chartAccounts);
  const split = usePrefs((s) => s.chartSplit);
  return useMemo(() => {
    if (!forecast) return null;
    const available = forecast.accounts.filter((s) => accounts.some((a) => a.id === s.accountId));
    const picked = available.filter((s) => chosen.includes(s.accountId));
    const selected = picked.length ? picked : available;
    const allSelected = selected.length === available.length;
    const lines: LineSeries[] = selected.map((s) => {
      const a = accounts.find((x) => x.id === s.accountId)!;
      return { id: s.accountId, name: displayName(a), color: accountColor(a, accounts), balances: s.balances };
    });
    if (allSelected && !split) {
      return {
        split,
        allSelected,
        days: forecast.days,
        events: forecast.events,
        lines,
        start: forecast.startBalanceMinor,
        end: forecast.endBalanceMinor,
        min: forecast.minBalanceMinor,
        minOn: forecast.minBalanceOn,
      };
    }
    const ids = new Set(selected.map((s) => s.accountId));
    const days = forecast.days.map((d, i) => ({ ...d, balanceMinor: selected.reduce((sum, s) => sum + (s.balances[i] ?? 0), 0) }));
    let min = days[0]?.balanceMinor ?? 0;
    let minOn = days[0]?.date ?? forecast.minBalanceOn;
    for (const d of days) {
      if (d.balanceMinor < min) {
        min = d.balanceMinor;
        minOn = d.date;
      }
    }
    return {
      split,
      allSelected,
      days,
      events: forecast.events.filter((e) => ids.has(e.accountId) || (e.toAccountId !== null && ids.has(e.toAccountId))),
      lines,
      start: days[0]?.balanceMinor ?? 0,
      end: days.at(-1)?.balanceMinor ?? 0,
      min,
      minOn,
    };
  }, [forecast, accounts, chosen, split]);
}

export function BalanceForecastChart({
  view,
  currency,
  height,
  compact,
}: {
  view: ForecastView;
  currency: string;
  height?: number | string;
  compact?: boolean;
}) {
  if (view.split && view.lines.length > 0) {
    return <AccountLinesChart dates={view.days.map((d) => d.date)} series={view.lines} currency={currency} height={height} compact={compact} />;
  }
  return <ForecastChart days={view.days} events={view.events} currency={currency} minOn={view.minOn} height={height} compact={compact} />;
}

export function ChartAccountPicker({ forecast, className }: { forecast: Forecast | undefined; className?: string }) {
  const { t } = useTranslation();
  const everyAccount = useAccounts().data ?? [];
  const accounts = everyAccount.filter((a) => forecast?.accounts.some((s) => s.accountId === a.id));
  const chosen = usePrefs((s) => s.chartAccounts).filter((id) => accounts.some((a) => a.id === id));
  const split = usePrefs((s) => s.chartSplit);
  const set = usePrefs((s) => s.set);
  const selected = chosen.length ? chosen : accounts.map((a) => a.id);
  const all = selected.length === accounts.length;
  const label = all
    ? t("forecastView.allAccounts")
    : selected.length === 1
      ? displayName(accounts.find((a) => a.id === selected[0])!)
      : t("forecastView.accounts", { count: selected.length });

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    set("chartAccounts", next.length === 0 || next.length === accounts.length ? [] : next);
  };

  if (accounts.length < 2) return null;
  return (
    <P.Root>
      <P.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 max-w-48 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-medium text-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:border-accent",
            className,
          )}
        >
          <Layers className="size-3.5 shrink-0" />
          <span className="truncate">{split ? `${label} · ${t("forecastView.split")}` : label}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-[300] flex w-72 flex-col gap-2 rounded-xl border border-border bg-surface p-2 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.25)] data-[state=open]:animate-[pop-in_140ms_var(--ease-out)]"
        >
          <Segmented<"sum" | "split">
            aria-label={t("forecastView.mode")}
            value={split ? "split" : "sum"}
            onChange={(v) => set("chartSplit", v === "split")}
            className="w-full"
            options={[
              { value: "sum", label: t("forecastView.sum") },
              { value: "split", label: t("forecastView.split") },
            ]}
          />
          <div className="flex flex-col">
            <CheckRow checked={all} onChange={() => set("chartAccounts", [])} label={<span className="font-medium">{t("forecastView.allAccounts")}</span>} />
            {accounts.map((a) => (
              <CheckRow
                key={a.id}
                checked={selected.includes(a.id)}
                onChange={() => toggle(a.id)}
                label={
                  <span className="flex items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: accountColor(a, everyAccount) }} />
                    <span className="truncate">{displayName(a)}</span>
                  </span>
                }
              />
            ))}
          </div>
          <p className="px-2.5 pb-1 text-[11px] text-muted">{t("forecastView.hint")}</p>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
