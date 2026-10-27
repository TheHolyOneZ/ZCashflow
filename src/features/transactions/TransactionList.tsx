import { useMemo } from "react";
import { Copy, CopyPlus, Hash, Paperclip, Pencil, Trash2 } from "lucide-react";
import { RowMenu, type MenuEntry } from "@/components/ui/context-menu";
import { writeClipboard } from "@/lib/clipboard";
import { minorToInput } from "@/lib/money";
import { useTranslation } from "react-i18next";
import { CategoryIcon } from "@/components/category-icon";
import { Amount } from "@/components/ui/misc";
import type { Account, Category, DayTotal, Transaction } from "@/lib/api";
import { formatDay, formatTime, isoDate } from "@/lib/dates";
import { Money } from "@/components/ui/extra";
import { activeLocale, displayName } from "@/lib/i18n";
import { useAccounts, useCategories, useDeleteTransaction } from "@/lib/queries";
import { useUi } from "@/stores/ui";

function groupByDay(txs: Transaction[]) {
  const groups: { day: string; items: Transaction[] }[] = [];
  for (const tx of txs) {
    const last = groups[groups.length - 1];
    if (last?.day === tx.occurredOn) last.items.push(tx);
    else groups.push({ day: tx.occurredOn, items: [tx] });
  }
  return groups;
}

export function TransactionList({ items, grouped = true, days }: { items: Transaction[]; grouped?: boolean; days?: DayTotal[] }) {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const accounts = useAccounts().data ?? [];
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const dayTotals = useMemo(() => {
    const m = new Map<string, DayTotal[]>();
    for (const d of days ?? []) m.set(d.date, [...(m.get(d.date) ?? []), d]);
    return m;
  }, [days]);

  if (!grouped) {
    return (
      <ul className="divide-y divide-border">
        {items.map((tx) => (
          <Row key={tx.id} tx={tx} category={byId.get(tx.categoryId ?? "")} accounts={accountsById} showDate />
        ))}
      </ul>
    );
  }

  const today = isoDate();
  const yesterday = isoDate(new Date(Date.now() - 86_400_000));
  return (
    <div className="flex flex-col">
      {groupByDay(items).map(({ day, items }) => (
        <section key={day}>
          <h3 className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-1.5 text-[12px] font-medium text-muted backdrop-blur">
            <span className="min-w-0 flex-1 truncate">
              {day === today
                ? t("common.today")
                : day === yesterday
                  ? t("common.yesterday")
                  : formatDay(day, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}
            </span>
            {(dayTotals.get(day) ?? []).map((d) => (
              <span key={d.currency} className="flex shrink-0 items-center gap-3">
                {d.incomeMinor > 0 && (
                  <span className="text-income" aria-label={t("kind.incomes")}>
                    <Money minor={d.incomeMinor} currency={d.currency} signed />
                  </span>
                )}
                {d.expenseMinor > 0 && (
                  <span className="text-expense" aria-label={t("kind.expenses")}>
                    <Money minor={-d.expenseMinor} currency={d.currency} />
                  </span>
                )}
              </span>
            ))}
          </h3>
          <ul className="divide-y divide-border">
            {items.map((tx) => (
              <Row key={tx.id} tx={tx} category={byId.get(tx.categoryId ?? "")} accounts={accountsById} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({
  tx,
  category,
  accounts,
  showDate,
}: {
  tx: Transaction;
  category?: Category;
  accounts: Map<string, Account>;
  showDate?: boolean;
}) {
  const { t } = useTranslation();
  const openEdit = useUi((s) => s.openEditTx);
  const account = accounts.get(tx.accountId);
  const toAccount = tx.toAccountId ? accounts.get(tx.toAccountId) : undefined;
  const openNew = useUi((s) => s.openNewTx);
  const toast = useUi((s) => s.toast);
  const del = useDeleteTransaction();
  const copy = (text: string) => writeClipboard(text).then(() => toast(t("menu.copied")));
  const txMenu: MenuEntry[] = [
    { label: t("common.edit"), icon: Pencil, onSelect: () => openEdit(tx) },
    {
      label: t("menu.duplicate"),
      icon: CopyPlus,
      onSelect: () =>
        openNew({
          kind: tx.kind,
          amountMinor: tx.amountMinor,
          accountId: tx.accountId,
          toAccountId: tx.toAccountId,
          categoryId: tx.categoryId,
          counterparty: tx.counterpartyName,
          title: tx.title,
          tags: tx.tags,
        }),
    },
    "separator",
    { label: t("menu.copyAmount"), icon: Copy, onSelect: () => copy(minorToInput(tx.amountMinor, tx.currency, activeLocale())) },
    { label: t("menu.copyRef"), icon: Hash, onSelect: () => copy(tx.ref) },
    "separator",
    { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => del.mutate(tx.id) },
  ];

  const meta = [
    tx.occurredTime ? formatTime(tx.occurredTime) : null,
    tx.kind === "transfer"
      ? `${account ? displayName(account) : "?"} → ${toAccount ? displayName(toAccount) : "?"}`
      : category
        ? displayName(category)
        : t("category.uncategorized"),
    tx.counterpartyName,
    showDate ? formatDay(tx.occurredOn) : null,
  ].filter(Boolean);

  return (
    <RowMenu items={txMenu}>
    <li>
      <button
        type="button"
        onClick={() => openEdit(tx)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      >
        <CategoryIcon category={category} kind={tx.kind} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {tx.title || tx.counterpartyName || <span className="text-muted">{t("tx.untitled")}</span>}
            {tx.attachmentCount > 0 && (
              <Paperclip aria-label={t("receipts.attached", { count: tx.attachmentCount })} className="ml-1.5 inline size-3 text-muted" />
            )}
          </div>
          <div className="truncate text-[12px] text-muted">
            {meta.join(" · ")}
            {tx.tags.length > 0 && (
              <span className="ml-1.5">{tx.tags.map((tag) => `#${tag}`).join(" ")}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <Amount minor={tx.amountMinor} currency={tx.currency} kind={tx.kind} />
          <span className="hidden text-[10.5px] text-muted/60 sm:block">{tx.ref}</span>
        </div>
      </button>
    </li>
    </RowMenu>
  );
}
