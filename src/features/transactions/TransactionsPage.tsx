import { cn } from "@/lib/cn";
import { DateInput } from "@/components/ui/date-input";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus, Receipt, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/inputs";
import { Card, EmptyState, Kbd, PageHeader } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import type { TransactionFilter, TxKind } from "@/lib/api";
import { displayName } from "@/lib/i18n";
import { useAccounts, useCategories, useTransactions } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { TransactionList } from "./TransactionList";
import { CategoryIcon } from "@/components/category-icon";
import { modKey } from "@/lib/platform";

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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showMore, setShowMore] = useState(false);
  const advanced = !!(accountId || categoryId || from || to);

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
        subtitle={t("tx.count", { count: items.length })}
        actions={
          <Button variant="primary" onClick={() => openNew()}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("tx.new")}</span>
          </Button>
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
                ...categories.map((c) => ({
                  value: c.id,
                  label: displayName(c),
                  indent: !!c.parentId,
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
          <TransactionList items={items} />
        )}
      </Card>
    </div>
  );
}
