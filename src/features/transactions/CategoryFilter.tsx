import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover as P } from "radix-ui";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/extra";
import { CategoryIcon } from "@/components/category-icon";
import type { TransactionFilter } from "@/lib/api";
import { breakdown, currenciesOf, nodeTotal, type BreakdownNode } from "@/lib/breakdown";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/i18n";
import { useAppInfo, useCategories, useCategoryTotals } from "@/lib/queries";

type Tab = "expense" | "income";

export function CategoryFilter({
  value,
  onChange,
  base,
  kind,
  className,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  base: TransactionFilter;
  kind?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const [open, setOpen] = useState(false);
  const selected = new Set(value);
  const first = value[0] !== undefined ? categories.find((c) => c.id === value[0]) : undefined;
  const label =
    value.length === 0
      ? `${t("tx.category")}: ${t("common.all")}`
      : value.length > 1
        ? t("tx.categoriesSelected", { count: value.length })
        : first
          ? displayName(first)
          : t("category.uncategorized");

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild>
        <button
          type="button"
          aria-label={t("tx.category")}
          className={cn(
            "group flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-left text-fg",
            "transition-[border-color,box-shadow] duration-150 hover:border-muted/40 active:scale-100",
            "focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-accent data-[state=open]:ring-2 data-[state=open]:ring-ring",
            value.length > 0 && "border-accent/40 bg-accent-soft",
            className,
          )}
        >
          {value.length === 1 && <CategoryIcon category={first} className="size-6 shrink-0 rounded-md [&_svg]:size-3.5" />}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronDown className="size-4 shrink-0 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[300] flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_12px_40px_-8px_rgb(0_0_0/0.25)] data-[state=open]:animate-[pop-in_140ms_var(--ease-out)]"
        >
          {open && <FilterPanel selected={selected} onChange={onChange} base={base} kind={kind} onClose={() => setOpen(false)} />}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

function FilterPanel({
  selected,
  onChange,
  base,
  kind,
  onClose,
}: {
  selected: Set<string>;
  onChange: (ids: string[]) => void;
  base: TransactionFilter;
  kind?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const main = useAppInfo().data?.mainCurrency;
  const sums = useCategoryTotals({ ...base, kind: undefined, categoryId: undefined, categoryIds: undefined }).data ?? [];
  const currency = currenciesOf(sums, main)[0] ?? main ?? "EUR";
  const [tab, setTab] = useState<Tab>(() => {
    if (kind === "income" || kind === "expense") return kind;
    const picked = categories.filter((c) => selected.has(c.id));
    return picked.length > 0 && picked.every((c) => c.kind === "income") ? "income" : "expense";
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const trees = useMemo(
    () => ({ expense: breakdown(categories, sums, "expense", currency), income: breakdown(categories, sums, "income", currency) }),
    [categories, sums, currency],
  );
  const nodes = trees[tab];

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const rows: { node: BreakdownNode; depth: number; inherited: boolean }[] = [];
  const walk = (list: BreakdownNode[], depth: number, inherited: boolean) => {
    for (const node of list) {
      rows.push({ node, depth, inherited });
      if (node.children.length && expanded.has(node.id)) walk(node.children, depth + 1, inherited || selected.has(node.id));
    }
  };
  walk(nodes, 0, false);

  return (
    <>
      <div className="grid grid-cols-2 gap-1 border-b border-border p-1.5">
        {(["expense", "income"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "flex min-w-0 flex-col items-start rounded-lg px-3 py-1.5 text-left transition-colors active:scale-100",
              tab === k ? "bg-surface-2" : "text-muted hover:bg-surface-2/60",
            )}
          >
            <span className={cn("text-[12px] font-semibold", tab === k && (k === "expense" ? "text-expense" : "text-income"))}>
              {k === "expense" ? t("kind.expenses") : t("kind.incomes")}
            </span>
            <Money minor={nodeTotal(trees[k])} currency={currency} className="truncate text-[12px] text-muted" />
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <FilterRow
          checked={selected.size === 0}
          onToggle={() => onChange([])}
          label={<span className="font-semibold">{t("common.all")}</span>}
        />
        {rows.map(({ node, depth, inherited }) => (
          <FilterRow
            key={node.id || "none"}
            depth={depth}
            checked={inherited || selected.has(node.id)}
            inherited={inherited}
            onToggle={() => toggle(node.id)}
            icon={<CategoryIcon category={node.category} className="size-6 rounded-md [&_svg]:size-3.5" />}
            label={node.category ? displayName(node.category) : t("category.uncategorized")}
            amount={node.total ? <Money minor={node.total} currency={currency} className="text-[12px] text-muted" /> : null}
            expanded={node.children.length ? expanded.has(node.id) : undefined}
            onExpand={() =>
              setExpanded((s) => {
                const next = new Set(s);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              })
            }
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border p-2">
        <Button variant="ghost" size="sm" disabled={selected.size === 0} onClick={() => onChange([])}>
          {t("tx.resetFilters")}
        </Button>
        <Button variant="primary" size="sm" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </>
  );
}

function FilterRow({
  checked,
  inherited,
  onToggle,
  icon,
  label,
  amount,
  depth = 0,
  expanded,
  onExpand,
}: {
  checked: boolean;
  inherited?: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
  label: React.ReactNode;
  amount?: React.ReactNode;
  depth?: number;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center rounded-lg hover:bg-surface-2" style={{ paddingLeft: `${depth * 1.25}rem` }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={inherited}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-1 pl-2.5 text-left text-[13px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-100"
      >
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
            checked ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface",
            inherited && "opacity-50",
          )}
        >
          {checked && <Check className="size-3" strokeWidth={3} />}
        </span>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {amount}
      </button>
      <button
        type="button"
        aria-label={expanded ? t("categories.collapse") : t("categories.expand")}
        aria-expanded={expanded}
        onClick={onExpand}
        className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:text-fg", expanded === undefined && "invisible")}
      >
        <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
      </button>
    </div>
  );
}
