import { useMemo, useRef, type MouseEvent } from "react";
import { Check, Copy, CopyPlus, Hash, ListChecks, Paperclip, Pencil, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/cn";

export interface Selection {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

type Pick = (id: string, e?: { shiftKey?: boolean }) => void;

function groupByDay(txs: Transaction[]) {
  const groups: { day: string; items: Transaction[] }[] = [];
  for (const tx of txs) {
    const last = groups[groups.length - 1];
    if (last?.day === tx.occurredOn) last.items.push(tx);
    else groups.push({ day: tx.occurredOn, items: [tx] });
  }
  return groups;
}

export function TransactionList({
  items,
  grouped = true,
  days,
  selection,
}: {
  items: Transaction[];
  grouped?: boolean;
  days?: DayTotal[];
  selection?: Selection;
}) {
  const { t } = useTranslation();
  const anchor = useRef<string | null>(null);
  const pick: Pick | undefined = selection
    ? (id, e) => {
        const next = new Set(selection.selected);
        const ids = items.map((i) => i.id);
        const a = anchor.current ? ids.indexOf(anchor.current) : -1;
        const b = ids.indexOf(id);
        if (e?.shiftKey && a >= 0 && b >= 0) {
          for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        selection.onChange(next);
      }
    : undefined;
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
          <Row key={tx.id} tx={tx} category={byId.get(tx.categoryId ?? "")} accounts={accountsById} showDate pick={pick} selection={selection} />
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
                    <Money flow minor={-d.expenseMinor} currency={d.currency} />
                  </span>
                )}
              </span>
            ))}
          </h3>
          <ul className="divide-y divide-border">
            {items.map((tx) => (
              <Row key={tx.id} tx={tx} category={byId.get(tx.categoryId ?? "")} accounts={accountsById} pick={pick} selection={selection} />
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
  pick,
  selection,
}: {
  tx: Transaction;
  category?: Category;
  accounts: Map<string, Account>;
  showDate?: boolean;
  pick?: Pick;
  selection?: Selection;
}) {
  const selecting = !!selection && selection.selected.size > 0;
  const selected = !!selection?.selected.has(tx.id);
  const { t } = useTranslation();
  const openEdit = useUi((s) => s.openEditTx);
  const account = accounts.get(tx.accountId);
  const toAccount = tx.toAccountId ? accounts.get(tx.toAccountId) : undefined;
  const openNew = useUi((s) => s.openNewTx);
  const toast = useUi((s) => s.toast);
  const del = useDeleteTransaction();
  const copy = (text: string) => writeClipboard(text).then(() => toast(t("menu.copied")));
  const txMenu: MenuEntry[] = [
    ...(pick ? [{ label: selected ? t("bulk.deselect") : t("bulk.select"), icon: ListChecks, onSelect: () => pick(tx.id) }] : []),
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
          toAmountMinor: tx.toAmountMinor,
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
        aria-pressed={selecting ? selected : undefined}
        onClick={(e: MouseEvent) => {
          if (pick && (selecting || e.ctrlKey || e.metaKey || e.shiftKey)) {
            e.preventDefault();
            pick(tx.id, e);
          } else openEdit(tx);
        }}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
          selected && "bg-accent-soft hover:bg-accent-soft",
        )}
      >
        {selecting && (
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
              selected ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface",
            )}
          >
            {selected && <Check className="size-3.5" strokeWidth={3} />}
          </span>
        )}
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
          {tx.toAmountMinor !== null && tx.toCurrency && (
            <span className="text-[11px] text-muted">
              → <Money minor={tx.toAmountMinor} currency={tx.toCurrency} />
            </span>
          )}
          <span className="hidden text-[10.5px] text-muted/60 sm:block">{tx.ref}</span>
        </div>
      </button>
    </li>
    </RowMenu>
  );
}
