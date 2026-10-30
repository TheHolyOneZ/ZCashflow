import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { ChevronLeft, ChevronRight, PieChart as PieIcon } from "lucide-react";
import { addMonths, addYears, endOfYear, startOfYear } from "date-fns";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Money } from "@/components/ui/extra";
import { CategoryIcon } from "@/components/category-icon";
import { breakdown, currenciesOf, nodeTotal, type BreakdownNode } from "@/lib/breakdown";
import { cn } from "@/lib/cn";
import { isoDate, monthRange } from "@/lib/dates";
import { percent } from "@/lib/format";
import { activeLocale, displayName } from "@/lib/i18n";
import { useAppInfo, useCategories, useCategoryTotals } from "@/lib/queries";

type Span = "month" | "year";
type Tab = "expense" | "income";

const PALETTE = ["#e76f51", "#f4a261", "#e9c46a", "#2a9d8f", "#264653", "#8ab17d", "#b5838d", "#6d597a", "#457b9d", "#c9ada7"];

function rangeOf(span: Span, at: Date) {
  return span === "month" ? monthRange(at) : { from: isoDate(startOfYear(at)), to: isoDate(endOfYear(at)) };
}

export function StatisticsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const categories = useCategories().data ?? [];
  const main = useAppInfo().data?.mainCurrency;
  const [span, setSpan] = useState<Span>("month");
  const [at, setAt] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>("expense");
  const [picked, setPicked] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const range = rangeOf(span, at);
  const sums = useCategoryTotals({ from: range.from, to: range.to }).data ?? [];
  const currencies = currenciesOf(sums, main);
  const currency = picked && currencies.includes(picked) ? picked : (currencies[0] ?? main ?? "EUR");
  const trees = useMemo(
    () => ({ expense: breakdown(categories, sums, "expense", currency), income: breakdown(categories, sums, "income", currency) }),
    [categories, sums, currency],
  );
  const nodes = trees[tab].filter((n) => n.total > 0);
  const total = nodeTotal(nodes);
  const colorOf = (n: BreakdownNode, i: number) => n.category?.color ?? (n.category ? PALETTE[i % PALETTE.length] : "var(--muted)");
  const slices = nodes.map((n, i) => ({ id: n.id, value: n.total, color: colorOf(n, i) }));
  const label =
    span === "month"
      ? new Intl.DateTimeFormat(activeLocale(), { month: "long", year: "numeric" }).format(at)
      : String(at.getFullYear());
  const step = (by: number) => setAt((d) => (span === "month" ? addMonths(d, by) : addYears(d, by)));
  const open = (id: string) => navigate({ to: "/transactions", search: { category: id, from: range.from, to: range.to } });

  const rows: { node: BreakdownNode; depth: number; color: string; share: number }[] = [];
  const walk = (list: BreakdownNode[], depth: number, whole: number, color: (n: BreakdownNode, i: number) => string) => {
    list
      .filter((n) => n.total > 0)
      .forEach((n, i) => {
        const c = color(n, i);
        rows.push({ node: n, depth, color: c, share: whole ? n.total / whole : 0 });
        if (expanded.has(n.id)) walk(n.children, depth + 1, n.total, () => c);
      });
  };
  walk(nodes, 0, total, colorOf);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("nav.statistics")}
        subtitle={t("stats.subtitle")}
        actions={
          currencies.length > 1 && (
            <Select
              aria-label={t("settings.currency")}
              value={currency}
              onValueChange={setPicked}
              className="w-24"
              items={currencies.map((c) => ({ value: c, label: c }))}
            />
          )
        }
      />
      <Card className="flex flex-wrap items-center justify-between gap-2 p-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={t("stats.previous")} onClick={() => step(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-0 flex-1 truncate text-center text-[14px] font-semibold capitalize sm:flex-none sm:px-2">{label}</span>
          <Button variant="ghost" size="icon" aria-label={t("stats.next")} onClick={() => step(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Segmented<Span>
          aria-label={t("stats.span")}
          value={span}
          onChange={setSpan}
          options={[
            { value: "month", label: t("stats.month") },
            { value: "year", label: t("stats.year") },
          ]}
        />
      </Card>
      <div className="grid grid-cols-2 gap-2">
        {(["income", "expense"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "flex min-w-0 flex-col items-start gap-0.5 rounded-xl border bg-surface px-4 py-2.5 text-left transition-colors active:scale-100",
              tab === k ? (k === "expense" ? "border-expense/60" : "border-income/60") : "border-border text-muted hover:bg-surface-2",
            )}
          >
            <span className={cn("text-[12px] font-semibold", tab === k && (k === "expense" ? "text-expense" : "text-income"))}>
              {k === "expense" ? t("kind.expenses") : t("kind.incomes")}
            </span>
            <Money minor={nodeTotal(trees[k])} currency={currency} className="max-w-full truncate text-[15px] font-semibold text-fg sm:text-[17px]" />
          </button>
        ))}
      </div>
      {nodes.length === 0 ? (
        <Card>
          <EmptyState title={t(tab === "expense" ? "stats.emptyExpenses" : "stats.emptyIncome")} icon={<PieIcon className="size-8" />} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
          <Card className="relative p-3">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="id"
                    innerRadius="64%"
                    outerRadius="92%"
                    paddingAngle={slices.length > 1 ? 1.5 : 0}
                    stroke="none"
                    isAnimationActive={false}
                    onClick={(_, i) => slices[i] && open(slices[i].id)}
                  >
                    {slices.map((s) => (
                      <Cell key={s.id || "none"} fill={s.color} className="cursor-pointer outline-none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] font-medium text-muted">{tab === "expense" ? t("kind.expenses") : t("kind.incomes")}</span>
              <Money minor={total} currency={currency} className="text-[15px] font-semibold" />
            </div>
          </Card>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {rows.map(({ node, depth, color, share }) => {
                const kids = node.children.filter((k) => k.total > 0);
                return (
                  <li key={`${depth}-${node.id || "none"}`} className={cn(depth > 0 && "bg-surface-2/40")}>
                    <div className="flex items-center gap-1 pr-1" style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
                      <button
                        type="button"
                        onClick={() => open(node.id)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 text-left active:scale-100"
                      >
                        <span
                          className="w-11 shrink-0 rounded-md py-0.5 text-center text-[11px] font-semibold tabular-nums"
                          style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
                        >
                          {percent(share)}
                        </span>
                        <CategoryIcon category={node.category} className={depth > 0 ? "size-7" : undefined} />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {node.category ? displayName(node.category) : t("category.uncategorized")}
                        </span>
                        <Money minor={node.total} currency={currency} className="shrink-0 text-[13px] font-semibold" />
                      </button>
                      <button
                        type="button"
                        aria-label={expanded.has(node.id) ? t("categories.collapse") : t("categories.expand")}
                        aria-expanded={expanded.has(node.id)}
                        onClick={() =>
                          setExpanded((s) => {
                            const next = new Set(s);
                            if (next.has(node.id)) next.delete(node.id);
                            else next.add(node.id);
                            return next;
                          })
                        }
                        className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:text-fg", !kids.length && "invisible")}
                      >
                        <ChevronRight className={cn("size-4 transition-transform", expanded.has(node.id) && "rotate-90")} />
                      </button>
                    </div>
                    {expanded.has(node.id) && kids.length > 0 && node.own > 0 && (
                      <p
                        className="flex items-center justify-between gap-2 border-t border-border bg-surface-2/40 py-2 pr-10 text-[12.5px] text-muted"
                        style={{ paddingLeft: `${4.25 + (depth + 1) * 1.25}rem` }}
                      >
                        <span className="truncate">{t("stats.direct")}</span>
                        <Money minor={node.own} currency={currency} className="shrink-0" />
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
