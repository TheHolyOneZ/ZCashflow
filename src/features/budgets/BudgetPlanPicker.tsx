import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Popover as P } from "radix-ui";
import { CalendarRange, ChevronDown } from "lucide-react";
import { Money, Switch } from "@/components/ui/extra";
import { CategoryIcon } from "@/components/category-icon";
import { planning, type Budget } from "@/lib/api";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/i18n";
import { useBudgets, useCategories, useErrorMessage, useSettings } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { CheckRow } from "@/features/data/CheckRow";

export function planSelection(setting: string | undefined, budgets: Budget[]): Set<string> {
  const v = (setting ?? "").trim();
  if (!v) return new Set();
  if (v === "all") return new Set(budgets.map((b) => b.id));
  const ids = new Set(v.split(",").map((x) => x.trim()));
  return new Set(budgets.filter((b) => ids.has(b.id)).map((b) => b.id));
}

export function useBudgetPlan() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const budgets = useBudgets().data ?? [];
  const setting = useSettings().data?.plan_budgets;
  const selected = planSelection(setting, budgets);
  const save = async (next: Set<string>) => {
    const value = next.size === 0 ? "" : next.size === budgets.length ? "all" : [...next].join(",");
    try {
      await planning.setSetting("plan_budgets", value);
      await qc.invalidateQueries();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  return { budgets, selected, save };
}

export function BudgetPlanPicker({ className }: { className?: string }) {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const { budgets, selected, save } = useBudgetPlan();
  if (!budgets.length) return null;
  const on = selected.size > 0;
  const label = !on
    ? t("budgetPlan.off")
    : selected.size === budgets.length
      ? t("budgetPlan.all")
      : t("budgetPlan.some", { count: selected.size, total: budgets.length });

  return (
    <P.Root>
      <P.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            on ? "border-accent/40 bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-fg",
            className,
          )}
        >
          <CalendarRange className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-[300] flex w-80 flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.25)] data-[state=open]:animate-[pop-in_140ms_var(--ease-out)]"
        >
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <span>
              <span className="block text-[13px] font-medium">{t("budgetPlan.title")}</span>
              <span className="mt-0.5 block text-[12px] text-muted">{t("budgetPlan.hint")}</span>
            </span>
            <Switch
              aria-label={t("budgetPlan.title")}
              checked={on}
              onCheckedChange={(v) => save(v ? new Set(budgets.map((b) => b.id)) : new Set())}
            />
          </label>
          <div className="-mx-1 flex max-h-72 flex-col overflow-y-auto border-t border-border pt-1">
            {budgets.map((b) => {
              const c = categories.find((x) => x.id === b.categoryId);
              return (
                <CheckRow
                  key={b.id}
                  checked={selected.has(b.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(b.id)) next.delete(b.id);
                    else next.add(b.id);
                    save(next);
                  }}
                  label={
                    <span className="flex items-center gap-2">
                      <CategoryIcon category={c} className="size-6 rounded-md [&_svg]:size-3.5" />
                      <span className="min-w-0 flex-1 truncate">{c ? displayName(c) : "—"}</span>
                      <span className="text-[12px] text-muted">
                        <Money minor={b.limitMinor} currency={b.currency} fractionClassName="hidden" /> / {t(`budgets.period_${b.period}`)}
                      </span>
                    </span>
                  }
                />
              );
            })}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
