import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Pencil, Plus, Sparkles } from "lucide-react";
import { BalanceDialog } from "@/features/accounts/BalanceDialog";
import { Tip } from "@/components/ui/inputs";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/misc";
import { Money, ProgressBar } from "@/components/ui/extra";
import { CashflowChart } from "@/components/charts";
import { BalanceForecastChart, ChartAccountPicker, useForecastView } from "@/components/forecast-view";
import { formatMoney } from "@/lib/money";
import { IconTile } from "@/components/category-icon";
import { StatTile } from "@/components/stat-tile";
import { TransactionList } from "@/features/transactions/TransactionList";
import { InsightList } from "@/features/insights/insights";
import { OccurrenceList } from "@/features/planner/PlannerPage";
import { BudgetCard } from "@/features/budgets/BudgetsPage";
import { formatDay, isoDate, monthRange } from "@/lib/dates";
import { daysFromToday, percent, relativeDays } from "@/lib/format";
import { activeLocale, displayName } from "@/lib/i18n";
import {
  useAccounts,
  useAppInfo,
  useBudgets,
  useForecast,
  useGoals,
  useInsights,
  useMonthlySeries,
  useRecurring,
  useSummary,
  useTransactions,
  useUpcoming,
} from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { type DashboardWidget, usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/cn";
import { GettingStarted } from "./GettingStarted";

function greetingKey() {
  const h = new Date().getHours();
  return h < 5 ? "evening" : h < 11 ? "morning" : h < 17 ? "day" : "evening";
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [balanceOpen, setBalanceOpen] = useState(false);
  const openNew = useUi((s) => s.openNewTx);
  const currency = useAppInfo().data?.mainCurrency ?? "EUR";
  const accounts = useAccounts().data ?? [];
  const range = useMemo(() => monthRange(), []);
  const summary = useSummary(range.from, range.to, currency).data;
  const recent = useTransactions({ limit: 6 }).data ?? [];
  const forecast = useForecast(30).data;
  const view = useForecastView(forecast);
  const insights = useInsights().data ?? [];
  const upcoming = useUpcoming(14).data ?? [];
  const series = useMonthlySeries(6).data ?? [];
  const budgets = useBudgets().data ?? [];
  const goals = (useGoals().data ?? []).filter((g) => !g.archived);
  const rules = useRecurring().data ?? [];

  const activeAccounts = accounts.filter((a) => !a.archived);
  const total = activeAccounts.filter((a) => a.currency === currency).reduce((s, a) => s + a.balanceMinor, 0);
  const otherTotals = [...new Set(activeAccounts.map((a) => a.currency))]
    .filter((c) => c !== currency)
    .map((c) => ({ currency: c, minor: activeAccounts.filter((a) => a.currency === c).reduce((s, a) => s + a.balanceMinor, 0) }));
  const fixed = rules
    .filter((r) => r.nextOn && r.kind === "expense" && r.currency === currency)
    .reduce((s, r) => s + r.monthlyMinor, 0);
  const next = forecast?.nextIncome;
  const hidden = usePrefs((s) => s.hiddenWidgets);
  const fresh = recent.length === 0 || rules.length === 0;
  const show = (w: DashboardWidget) => !hidden.includes(w);
  const pair = (a: boolean, b: boolean) =>
    cn("grid grid-cols-1 gap-3", a && b && "lg:grid-cols-[minmax(0,1fr)_24rem]", !a && !b && "hidden");
  const side = show("accounts") || (show("budgets") && budgets.length > 0) || (show("goals") && goals.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t(`dashboard.greeting.${greetingKey()}`)}
        subtitle={formatDay(isoDate(), { weekday: "long", day: "numeric", month: "long" })}
        actions={
          <Button variant="primary" onClick={() => openNew()}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("tx.new")}</span>
          </Button>
        }
      />

      {fresh && <GettingStarted />}

      <div className={pair(show("hero"), show("insights"))}>
        {show("hero") && (
        <Card className="relative flex min-h-80 flex-col overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--accent)_10%,transparent),transparent_70%)] dark:bg-[radial-gradient(circle,color-mix(in_srgb,var(--accent)_18%,transparent),transparent_70%)]" />
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 pb-0">
            <div>
              <div className="flex items-center gap-1 text-[12px] font-medium text-muted">
                {t("dashboard.balance")}
                <Tip label={t("balance.title")}>
                  <button
                    type="button"
                    aria-label={t("balance.title")}
                    onClick={() => setBalanceOpen(true)}
                    className="flex size-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </Tip>
              </div>
              <Money minor={total} currency={currency} tone="auto" className="text-[34px] leading-tight font-semibold tracking-tight" />
              {otherTotals.length > 0 && (
                <div className="flex flex-wrap gap-x-3 text-[12px] text-muted">
                  {otherTotals.map((o) => (
                    <span key={o.currency}>
                      + <Money minor={o.minor} currency={o.currency} tone="auto" /> {t("dashboard.inCurrency", { currency: o.currency })}
                    </span>
                  ))}
                </div>
              )}
              <BalanceDialog open={balanceOpen} onOpenChange={setBalanceOpen} />
            </div>
            {forecast && (
              <div className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-right">
                <div className="text-[11px] font-medium text-accent">{t("dashboard.safeToSpend")}</div>
                <div className="text-[18px] font-semibold">
                  <Money minor={forecast.safeDailyMinor} currency={currency} />
                  <span className="text-[12px] font-normal text-muted"> / {t("dashboard.day")}</span>
                </div>
                <div className="text-[11px] text-muted">
                  {next
                    ? t("dashboard.untilIncome", { title: next.title, when: relativeDays(daysFromToday(next.date)) })
                    : t("planner.until", { date: formatDay(forecast.safeUntil) })}
                </div>
                {forecast.budgetsIncluded && forecast.budgetReservedMinor > 0 && (
                  <div className="text-[11px] text-muted">
                    {t("dashboard.budgetsReserved", { amount: formatMoney(forecast.budgetReservedMinor, currency, activeLocale()) })}
                  </div>
                )}
              </div>
            )}
          </div>
          {forecast && view && (
            <>
              <div className="min-h-32 flex-1 pt-2">
                <BalanceForecastChart view={view} currency={currency} height="100%" compact />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2.5 text-[12px] text-muted">
                <span>
                  {t("dashboard.in30Days")}{" "}
                  {view.split ? (
                    view.lines.map((l, i) => (
                      <span key={l.id}>
                        {i > 0 && " · "}
                        <span style={{ color: l.color }}>●</span>{" "}
                        <Money minor={l.balances.at(-1) ?? 0} currency={currency} tone="auto" className="font-medium text-fg" />
                      </span>
                    ))
                  ) : (
                    <Money minor={view.end} currency={currency} tone="auto" className="font-medium text-fg" />
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <ChartAccountPicker forecast={forecast} className="h-7" />
                  <Link to="/planner" className="flex items-center gap-1 font-medium text-accent hover:underline">
                    {t("nav.planner")}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </span>
              </div>
            </>
          )}
        </Card>
        )}

        {show("insights") && (
        <Card className="flex flex-col overflow-hidden">
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-accent" />
                {t("dashboard.forYou")}
              </span>
            }
          />
          {insights.length ? (
            <div className="pb-2">
              <InsightList items={insights} limit={6} />
            </div>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-muted">{t("dashboard.allGood")}</p>
          )}
        </Card>
        )}
      </div>

      {show("stats") && (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("dashboard.income")} hint={t("dashboard.thisMonth")}>
          {summary && <Money minor={summary.incomeMinor} currency={currency} className="text-income" />}
        </StatTile>
        <StatTile label={t("dashboard.expenses")} hint={t("dashboard.thisMonth")}>
          {summary && <Money minor={summary.expenseMinor} currency={currency} />}
        </StatTile>
        <StatTile label={t("dashboard.net")} hint={t("dashboard.thisMonth")}>
          {summary && <Money minor={summary.netMinor} currency={currency} signed tone="auto" />}
        </StatTile>
        <StatTile
          label={t("recurring.fixedPerMonth")}
          hint={summary && summary.incomeMinor > 0 ? t("dashboard.ofIncome", { percent: percent(fixed / summary.incomeMinor) }) : undefined}
        >
          <Money minor={fixed} currency={currency} />
        </StatTile>
      </div>
      )}

      <div className={pair(show("cashflow"), show("upcoming"))}>
        {show("cashflow") && (
        <Card>
          <CardHeader title={t("dashboard.cashflow")} />
          <div className="px-3 pb-3">
            <CashflowChart data={series} currency={currency} height={200} />
          </div>
        </Card>
        )}
        {show("upcoming") && (
        <Card className="overflow-hidden">
          <CardHeader
            title={t("dashboard.upcoming")}
            action={
              <Link to="/recurring" className="text-[12px] font-medium text-accent hover:underline">
                {t("dashboard.showAll")}
              </Link>
            }
          />
          {upcoming.length ? (
            <div className="max-h-64 overflow-y-auto px-1 pb-2">
              <OccurrenceList items={upcoming.slice(0, 12)} showDate />
            </div>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-muted">{t("dashboard.noUpcoming")}</p>
          )}
        </Card>
        )}
      </div>

      <div className={pair(show("recent"), side)}>
        {show("recent") && (
        <Card className="overflow-hidden">
          <CardHeader
            title={t("dashboard.recent")}
            action={
              <Link to="/transactions" className="flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                {t("dashboard.showAll")}
                <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {recent.length ? <TransactionList items={recent} grouped={false} /> : <EmptyState title={t("tx.empty")} />}
        </Card>
        )}

        {side && (
        <div className={cn("grid grid-cols-1 gap-3", !show("recent") && "md:grid-cols-2 xl:grid-cols-3")}>
          {show("accounts") && (
          <Card>
            <CardHeader title={t("dashboard.accounts")} action={<Link to="/accounts" className="text-[12px] font-medium text-accent hover:underline">{t("common.manage")}</Link>} />
            <ul className="px-4 pb-3">
              {activeAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: a.color ?? "var(--accent)" }} />
                    <span className="truncate">{displayName(a)}</span>
                  </span>
                  <Money minor={a.balanceMinor} currency={a.currency} tone="auto" className="font-medium" />
                </li>
              ))}
            </ul>
          </Card>
          )}

          {show("budgets") && budgets.length > 0 && (
            <Card>
              <CardHeader title={t("nav.budgets")} action={<Link to="/budgets" className="text-[12px] font-medium text-accent hover:underline">{t("dashboard.showAll")}</Link>} />
              <div className="px-4 pb-3">
                {budgets.slice(0, 4).map((b) => (
                  <BudgetCard key={b.id} budget={b} compact />
                ))}
              </div>
            </Card>
          )}

          {show("goals") && goals.length > 0 && (
            <Card>
              <CardHeader title={t("nav.goals")} action={<Link to="/goals" className="text-[12px] font-medium text-accent hover:underline">{t("dashboard.showAll")}</Link>} />
              <ul className="flex flex-col gap-3 px-4 pb-4">
                {goals.slice(0, 3).map((g) => (
                  <li key={g.id} className="flex items-center gap-3">
                    <IconTile icon={g.icon ?? "piggy-bank"} color={g.color} className="size-7" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="truncate font-medium">{g.title}</span>
                        <span className="text-muted">{percent(g.progress)}</span>
                      </div>
                      <ProgressBar value={g.progress} color={g.color ?? undefined} className="mt-1" />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
