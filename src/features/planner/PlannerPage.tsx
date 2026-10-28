import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { addMonths, format, getDay, getDaysInMonth, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Money } from "@/components/ui/extra";
import { BalanceForecastChart, ChartAccountPicker, useForecastView } from "@/components/forecast-view";
import { BudgetPlanPicker } from "@/features/budgets/BudgetPlanPicker";
import { CategoryIcon } from "@/components/category-icon";
import type { MonthPreview, Occurrence } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDay, formatTime, isoDate } from "@/lib/dates";
import { monthLabel, relativeDays, daysFromToday } from "@/lib/format";
import { activeLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { useBudgets, useCategories, useForecast, useMonthPreview } from "@/lib/queries";
import { displayName } from "@/lib/i18n";

type Horizon = "30" | "90" | "180" | "365";

export function PlannerPage() {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [horizon, setHorizon] = useState<Horizon>("90");
  const month = format(addMonths(new Date(), offset), "yyyy-MM");
  const preview = useMonthPreview(month).data;
  const forecast = useForecast(Number(horizon)).data;
  const view = useForecastView(forecast);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("nav.planner")}
        subtitle={t("planner.subtitle")}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
            <Button size="icon" variant="ghost" className="size-8" disabled={offset === 0} onClick={() => setOffset((o) => o - 1)} aria-label={t("planner.prevMonth")}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-32 text-center text-[13px] font-semibold">{monthLabel(month)}</span>
            <Button size="icon" variant="ghost" className="size-8" disabled={offset >= 11} onClick={() => setOffset((o) => o + 1)} aria-label={t("planner.nextMonth")}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      {preview && <MonthBudget preview={preview} />}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {preview && <PaymentCalendar preview={preview} />}
        {preview && <MonthItems items={preview.items} />}
      </div>

      <Card>
        <CardHeader
          title={t("planner.balanceForecast")}
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ChartAccountPicker forecast={forecast} />
              <Segmented<Horizon>
                aria-label={t("planner.horizon")}
                value={horizon}
                onChange={setHorizon}
                options={[
                  { value: "30", label: t("planner.days", { count: 30 }) },
                  { value: "90", label: t("planner.days", { count: 90 }) },
                  { value: "180", label: t("planner.months", { count: 6 }) },
                  { value: "365", label: t("planner.months", { count: 12 }) },
                ]}
              />
            </div>
          }
        />
        <div className="px-2 pb-3">
          {forecast && view && (
            <>
              <BalanceForecastChart view={view} currency={forecast.currency} height={260} />
              <div className="grid grid-cols-2 gap-3 px-2 pt-3 text-[12px] sm:grid-cols-4">
                <Fact label={t("planner.today")}>
                  <Money minor={view.start} currency={forecast.currency} tone="auto" />
                </Fact>
                <Fact label={t("planner.lowest")} hint={formatDay(view.minOn)}>
                  <Money minor={view.min} currency={forecast.currency} tone="auto" />
                </Fact>
                <Fact label={t("planner.endOfRange")} hint={forecast.days.at(-1) && formatDay(forecast.days.at(-1)!.date)}>
                  <Money minor={view.end} currency={forecast.currency} tone="auto" />
                </Fact>
                <Fact label={t("planner.safeDaily")} hint={t("planner.until", { date: formatDay(forecast.safeUntil) })}>
                  <Money minor={forecast.safeDailyMinor} currency={forecast.currency} className="text-accent" />
                </Fact>
              </div>
              <p className="px-2 pt-3 text-[11px] text-muted">
                {t("planner.forecastNote", {
                  amount: formatMoney(forecast.dailyVariableMinor, forecast.currency, activeLocale()),
                })}
                {forecast.budgetsIncluded && ` ${t("planner.forecastBudgets")}`}
                {!view.allSelected && ` ${t("planner.forecastSubset")}`}
              </p>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function Fact({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className="text-[15px] font-semibold">{children}</div>
      {hint && <div className="text-muted">{hint}</div>}
    </div>
  );
}

function MonthBudget({ preview: p }: { preview: MonthPreview }) {
  const { t } = useTranslation();
  const hasBudgets = (useBudgets().data ?? []).length > 0;
  const categories = useCategories().data ?? [];
  const budgetsOn = p.budgets.length > 0;
  const base = Math.max(p.expectedIncomeMinor, p.fixedExpenseMinor + p.variableExpenseMinor + p.budgetExpenseMinor + p.savingsTargetMinor, 1);
  const budgetNames = p.budgets
    .filter((b) => b.amountMinor > 0)
    .map((b) => categories.find((c) => c.id === b.categoryId))
    .filter((c) => !!c)
    .map((c) => displayName(c!))
    .join(", ");
  const rows = [
    { label: t("planner.expectedIncome"), minor: p.expectedIncomeMinor, color: "var(--chart-in)", sign: 1 },
    { label: t("planner.fixedCosts"), minor: p.fixedExpenseMinor, color: "var(--chart-out)", sign: -1 },
    ...(budgetsOn
      ? [{ label: t("planner.budgets"), hint: budgetNames || (p.isCurrent ? t("planner.budgetsHintRest") : undefined), minor: p.budgetExpenseMinor, color: "var(--warn)", sign: -1 }]
      : []),
    {
      label: budgetsOn ? t("planner.variableOther") : t("planner.variableCosts"),
      hint: p.isCurrent ? t("planner.variableHintRest") : t("planner.variableHint"),
      minor: p.variableExpenseMinor,
      color: "var(--chart-out)",
      sign: -1,
    },
    { label: t("planner.savings"), hint: t("planner.savingsHint"), minor: p.savingsTargetMinor, color: "var(--accent)", sign: -1 },
  ];
  const free = p.freeMinor;
  const days = getDaysInMonth(parseISO(p.from));
  const remainingDays = p.from <= isoDate() ? days - Number(isoDate().slice(8)) + 1 : days;

  return (
    <Card className="grid grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-muted">
            {p.isCurrent ? t("planner.restOfMonth", { month: monthLabel(p.month, { month: "long" }) }) : t("planner.monthPlan", { month: monthLabel(p.month, { month: "long" }) })}
          </h2>
          {hasBudgets && <BudgetPlanPicker />}
        </div>
        <ul className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
              <span className="text-[13px]">
                {r.label}
                {r.hint && <span className="ml-1.5 text-[12px] text-muted">{r.hint}</span>}
              </span>
              <Money flow minor={r.sign * r.minor} currency={p.currency} signed className="text-right font-medium" />
              <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${(r.minor / base) * 100}%`, background: r.color, opacity: r.sign < 0 ? 0.85 : 1 }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col justify-center gap-1 border-t border-border bg-surface-2/50 p-5 lg:border-t-0 lg:border-l">
        <span className="text-[12px] font-medium text-muted">{t("planner.free")}</span>
        <Money minor={free} currency={p.currency} signed tone="auto" className="text-[32px] leading-10 font-semibold tracking-tight" />
        <span className="text-[12px] text-muted">
          {free > 0
            ? t("planner.freePerDay", {
                amount: formatMoney(Math.floor(free / Math.max(1, remainingDays)), p.currency, activeLocale()),
              })
            : t("planner.freeNegative")}
        </span>
        <div className="mt-3 flex justify-between border-t border-border pt-3 text-[12px]">
          <span className="text-muted">{p.isCurrent ? t("planner.balanceToday") : t("planner.balanceStart")}</span>
          <Money minor={p.startBalanceMinor} currency={p.currency} tone="auto" />
        </div>
        <div className="flex justify-between text-[12px]">
          <span className="text-muted">{t("planner.balanceEnd")}</span>
          <Money minor={p.endBalanceMinor} currency={p.currency} tone="auto" className="font-medium" />
        </div>
      </div>
    </Card>
  );
}

function PaymentCalendar({ preview: p }: { preview: MonthPreview }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const first = parseISO(p.from);
  const lead = (getDay(first) + 6) % 7;
  const count = getDaysInMonth(first);
  const today = isoDate();
  const byDay = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of p.items) {
      const d = o.date < today ? today : o.date;
      m.set(d, [...(m.get(d) ?? []), o]);
    }
    return m;
  }, [p.items, today]);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(activeLocale(), { weekday: "short" }).format(new Date(2024, 0, 1 + i)),
  );
  const selectedItems = selected ? (byDay.get(selected) ?? []) : [];

  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("planner.calendar")} />
      <div className="grid grid-cols-7 gap-px border-y border-border bg-border text-[11px]">
        {weekdays.map((w) => (
          <div key={w} className="bg-surface px-2 py-1 text-center font-medium text-muted">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} className="bg-surface-2/40" />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const date = `${p.month}-${String(i + 1).padStart(2, "0")}`;
          const items = byDay.get(date) ?? [];
          const net = items.reduce((s, o) => s + (o.kind === "income" ? o.amountMinor : o.kind === "expense" ? -o.amountMinor : 0), 0);
          const past = date < today;
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelected(items.length ? (selected === date ? null : date) : null)}
              className={cn(
                "flex min-h-16 flex-col items-start gap-0.5 bg-surface p-1.5 text-left hover:bg-surface-2 active:scale-100 sm:min-h-20",
                past && "bg-surface-2/40 text-muted",
                selected === date && "ring-2 ring-accent ring-inset",
              )}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[11px] font-medium",
                  date === today && "bg-accent text-accent-fg",
                )}
              >
                {i + 1}
              </span>
              {items.slice(0, 2).map((o) => (
                <span
                  key={o.ruleId}
                  className={cn(
                    "w-full truncate rounded px-1 text-[10px] leading-4",
                    o.kind === "income" ? "bg-income/12 text-income" : o.kind === "transfer" ? "bg-transfer/12 text-transfer" : "bg-surface-2 text-fg",
                  )}
                >
                  <span className="hidden sm:inline">{o.title}</span>
                  <span className="sm:hidden">•</span>
                </span>
              ))}
              {items.length > 2 && <span className="text-[10px] text-muted">+{items.length - 2}</span>}
              {items.length > 0 && (
                <Money minor={net} currency={p.currency} signed tone="auto" fractionClassName="hidden" className="mt-auto hidden text-[10px] font-medium sm:block" />
              )}
            </button>
          );
        })}
      </div>
      {selected && selectedItems.length > 0 && (
        <div className="p-3">
          <div className="mb-1 text-[12px] font-medium text-muted">{formatDay(selected, { weekday: "long", day: "numeric", month: "long" })}</div>
          <OccurrenceList items={selectedItems} />
        </div>
      )}
    </Card>
  );
}

function MonthItems({ items }: { items: Occurrence[] }) {
  const { t } = useTranslation();
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("planner.allPayments", { count: items.length })} />
      {items.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-muted">{t("planner.noPayments")}</p>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto px-1 pb-2">
          <OccurrenceList items={items} showDate />
        </div>
      )}
    </Card>
  );
}

export function OccurrenceList({ items, showDate }: { items: Occurrence[]; showDate?: boolean }) {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  return (
    <ul className="flex flex-col">
      {items.map((o) => {
        const days = daysFromToday(o.date);
        return (
          <li key={`${o.ruleId}:${o.date}`} className="flex items-center gap-3 rounded-lg px-3 py-1.5">
            <CategoryIcon category={categories.find((c) => c.id === o.categoryId)} kind={o.kind} debt={!!o.debtId} className="size-7" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{o.title}</div>
              {showDate && (
                <div className="text-[11px] text-muted">
                  {o.overdue && !o.autoPost ? t("planner.awaiting") : days <= 7 ? relativeDays(days) : formatDay(o.date)}
                  {o.time && `, ${formatTime(o.time)}`}
                </div>
              )}
            </div>
            <Money
              flow
              minor={o.kind === "income" ? o.amountMinor : -o.amountMinor}
              currency={o.currency}
              signed={o.kind === "income"}
              className={cn("text-[13px] font-medium", o.kind === "income" && "text-income", o.kind === "transfer" && "text-transfer")}
            />
          </li>
        );
      })}
    </ul>
  );
}
