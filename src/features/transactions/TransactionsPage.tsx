import { cn } from "@/lib/cn";
import { DateInput } from "@/components/ui/date-input";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CalendarRange, ChevronLeft, ChevronRight, Download, Plus, Receipt, Search, SlidersHorizontal, Upload, X } from "lucide-react";
import { addMonths, endOfMonth, parseISO, startOfMonth } from "date-fns";
import { ImportDialog } from "@/features/data/ImportDialog";
import { useExportFile } from "@/features/data/export";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { SearchInput, Tip } from "@/components/ui/inputs";
import { Card, EmptyState, Kbd, PageHeader } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import type { TransactionFilter, TransactionTotals, TxKind } from "@/lib/api";
import { categoryTree } from "@/lib/categories";
import { displayName } from "@/lib/i18n";
import { useAccounts, useCategories, useTransactionTotals, useTransactions } from "@/lib/queries";
import { Money } from "@/components/ui/extra";
import { useUi } from "@/stores/ui";
import { TransactionList } from "./TransactionList";
import { CategoryIcon } from "@/components/category-icon";
import { modKey } from "@/lib/platform";
import { formatDay, isoDate, monthRange } from "@/lib/dates";
import { activeLocale } from "@/lib/i18n";
import { usePrefs } from "@/stores/prefs";

type KindFilter = TxKind | "all";

export function TransactionsPage() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { q?: string };
  const navigate = useNavigate();
  const openNew = useUi((s) => s.openNewTx);
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];

  const [query, setQuery] = useState(search.q ?? "");
  const [kind, setKind] = useState<KindFilter>("all");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [initial] = useState(() =>
    usePrefs.getState().txPeriod === "month" && !search.q ? monthRange() : { from: "", to: "" },
  );
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [showMore, setShowMore] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const exportFile = useExportFile();
  const advanced = !!(accountId || categoryId || ((from || to) && !fullMonth(from, to)));

  useEffect(() => setQuery(search.q ?? ""), [search.q]);

  const deferredQuery = useDeferredValue(query);
  const filter = useMemo<TransactionFilter>(
    () => ({
      query: deferredQuery.trim() || undefined,
      kind: kind === "all" ? undefined : kind,
      accountId: accountId || undefined,
      categoryId: categoryId || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [deferredQuery, kind, accountId, categoryId, from, to],
  );
  const { data: items = [], isLoading } = useTransactions(filter);
  const totals = useTransactionTotals(filter).data;
  const filtered = Object.values(filter).some((v) => v !== undefined);

  function clear() {
    setQuery("");
    setKind("all");
    setAccountId("");
    setCategoryId("");
    setFrom("");
    setTo("");
    navigate({ to: "/transactions", search: {} });
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t("nav.transactions")}
        subtitle={t("tx.count", { count: Math.max(totals?.count ?? 0, items.length) })}
        actions={
          <>
            <Tip label={t("dataTransfer.exportSelection")}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("dataTransfer.exportSelection")}
                disabled={!items.length}
                onClick={() => exportFile({ datasets: ["transactions"], filter }, "zcashflow-transactions")}
              >
                <Download className="size-4" />
              </Button>
            </Tip>
            <Tip label={t("settings.importCsv")}>
              <Button variant="ghost" size="icon" aria-label={t("settings.importCsv")} onClick={() => setImportOpen(true)}>
                <Upload className="size-4" />
              </Button>
            </Tip>
            <Button variant="primary" onClick={() => openNew()}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("tx.new")}</span>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput aria-label={t("common.search")} placeholder={t("tx.searchPlaceholder")} value={query} onChange={setQuery} className="min-w-[11rem] flex-1 sm:min-w-64" />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("tx.filters")}
              aria-expanded={showMore || advanced}
              onClick={() => setShowMore((v) => !v)}
              className={cn("relative sm:hidden", (showMore || advanced) && "bg-surface-2 text-fg")}
            >
              <SlidersHorizontal className="size-4" />
              {advanced && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent" />}
            </Button>
            <Segmented<KindFilter>
              aria-label={t("kind.expense")}
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: t("common.all") },
                { value: "expense", label: t("kind.expense") },
                { value: "income", label: t("kind.income") },
                { value: "transfer", label: t("kind.transfer") },
              ]}
            />
          </div>
          <div className={cn("grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap", showMore || advanced ? "grid" : "hidden")}>
            <Select
              aria-label={t("tx.account")}
              value={accountId}
              onValueChange={setAccountId}
              className="w-full sm:w-44"
              items={[
                { value: "", label: `${t("tx.account")}: ${t("common.all")}` },
                ...accounts.map((a) => ({
                  value: a.id,
                  label: displayName(a),
                  icon: <span className="block size-2.5 rounded-full" style={{ background: a.color ?? "var(--accent)" }} />,
                })),
              ]}
            />
            <Select
              aria-label={t("tx.category")}
              value={categoryId}
              onValueChange={setCategoryId}
              className="w-full sm:w-48"
              items={[
                { value: "", label: `${t("tx.category")}: ${t("common.all")}` },
                ...categoryTree(categories).map(({ category: c, depth }) => ({
                  value: c.id,
                  label: displayName(c),
                  depth,
                  icon: <CategoryIcon category={c} className="size-6 rounded-md [&_svg]:size-3.5" />,
                })),
              ]}
            />
            <div className="col-span-2 flex items-center gap-1.5">
              <DateInput clearable
                aria-label={t("tx.filterFrom")}
                placeholder={t("tx.filterFrom")}
                value={from}
                onChange={setFrom}
                className="min-w-0 flex-1 sm:w-40 sm:flex-none"
              />
              <span className="text-muted">–</span>
              <DateInput clearable
                aria-label={t("tx.filterTo")}
                placeholder={t("tx.filterTo")}
                value={to}
                onChange={setTo}
                className="min-w-0 flex-1 sm:w-40 sm:flex-none"
              />
            </div>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clear} className="col-span-2 justify-self-start">
                <X className="size-3.5" />
                {t("tx.resetFilters")}
              </Button>
            )}
          </div>
        </div>

        <PeriodBar
          from={from}
          to={to}
          onChange={(r) => {
            setFrom(r.from);
            setTo(r.to);
          }}
        />
        {totals && kind !== "transfer" && (totals.count > 0 || totals.currencies.some((c) => c.closingMinor !== null)) && (
          <TotalsBar totals={totals} to={to} />
        )}

        {isLoading ? (
          <p className="p-6 text-center text-muted">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState title={t("tx.noResults")} icon={<Search className="size-8" />} />
          ) : (
            <EmptyState
              title={t("tx.empty")}
              hint={
                <Trans
                  i18nKey="tx.emptyHint"
                  values={{ shortcut: `${modKey} K` }}
                  components={{ kbd: <Kbd>{null}</Kbd> }}
                />
              }
              icon={<Receipt className="size-8" />}
            />
          )
        ) : (
          <TransactionList items={items} days={totals?.days} />
        )}
      </Card>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function fullMonth(from: string, to: string): Date | null {
  if (!from || !to) return null;
  const start = parseISO(from);
  return isoDate(startOfMonth(start)) === from && isoDate(endOfMonth(start)) === to ? start : null;
}

function PeriodBar({ from, to, onChange }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  const { t } = useTranslation();
  const month = fullMonth(from, to);
  if (from || to) {
    if (!month) return null;
    const label = new Intl.DateTimeFormat(activeLocale(), { month: "long", year: "numeric" }).format(month);
    return (
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <Button variant="ghost" size="icon" aria-label={t("tx.prevMonth")} onClick={() => onChange(monthRange(addMonths(month, -1)))}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-[13.5px] font-semibold capitalize">{label}</span>
        <Button variant="ghost" size="icon" aria-label={t("tx.nextMonth")} onClick={() => onChange(monthRange(addMonths(month, 1)))}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5 text-[12px] text-muted">
      <span>{t("tx.allTime")}</span>
      <Button variant="ghost" size="sm" onClick={() => onChange(monthRange())}>
        <CalendarRange className="size-3.5" />
        {t("tx.monthView")}
      </Button>
    </div>
  );
}

function TotalsBar({ totals, to }: { totals: TransactionTotals; to: string }) {
  const { t } = useTranslation();
  const several = totals.currencies.length > 1;
  const today = isoDate();
  const endLabel = !to || to === today ? t("tx.balanceToday") : t("tx.balanceOn", { date: formatDay(to) });
  return (
    <div className="flex flex-col divide-y divide-border border-b border-border bg-surface-2/40">
      {totals.currencies.map((c) => (
        <div key={c.currency} className="flex flex-col gap-2 px-3 py-2.5 sm:px-4">
          {c.count > 0 && (
            <dl className="grid grid-cols-3 gap-1.5 text-center sm:gap-2">
              {[
                { label: t("kind.incomes"), value: <Money minor={c.incomeMinor} currency={c.currency} className="text-income" /> },
                { label: t("kind.expenses"), value: <Money minor={c.expenseMinor} currency={c.currency} className="text-expense" /> },
                {
                  label: several ? `${t("dashboard.net")} · ${c.currency}` : t("dashboard.net"),
                  value: <Money minor={c.incomeMinor - c.expenseMinor} currency={c.currency} signed tone="auto" />,
                },
              ].map((x) => (
                <div key={x.label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="truncate text-[11px] font-medium text-muted">{x.label}</dt>
                  <dd className="truncate text-[13px] font-semibold sm:text-[15px]">{x.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {c.closingMinor !== null && (
            <p
              className={cn(
                "flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-[12px] text-muted",
                c.count > 0 && "border-t border-border/60 pt-2",
              )}
            >
              {c.openingMinor !== null && (
                <span>
                  {t("tx.carriedOver")}: <Money minor={c.openingMinor} currency={c.currency} tone="auto" className="font-medium" />
                </span>
              )}
              <span>
                {endLabel}: <Money minor={c.closingMinor} currency={c.currency} tone="auto" className="font-medium text-fg" />
              </span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
