import { Pencil, Trash2, Plus, Wallet } from "lucide-react";
import { RowMenu } from "@/components/ui/context-menu";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/field";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Badge, ConfirmDeleteButton, FormFooter, Money, MoneyInput, ProgressBar } from "@/components/ui/extra";
import { CategoryIcon } from "@/components/category-icon";
import { CategorySelect } from "@/components/selects";
import { planning, type Budget, type BudgetPeriod } from "@/lib/api";
import { percent } from "@/lib/format";
import { activeLocale, displayName } from "@/lib/i18n";
import { minorToInput, parseMoney } from "@/lib/money";
import { useAppInfo, useAppMutation, useBudgets, useCategories } from "@/lib/queries";

export function budgetTone(b: Budget): "ok" | "warn" | "over" {
  return b.spentMinor > b.limitMinor ? "over" : b.progress >= 0.8 ? "warn" : "ok";
}

export function BudgetsPage() {
  const { t } = useTranslation();
  const budgets = useBudgets().data ?? [];
  const [edit, setEdit] = useState<{ budget?: Budget } | null>(null);
  const delBudget = useAppMutation(planning.deleteBudget, { success: t("common.deleted") });

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("nav.budgets")}
        subtitle={t("budgets.subtitle")}
        actions={
          <Button variant="primary" onClick={() => setEdit({})}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("budgets.new")}</span>
          </Button>
        }
      />
      {budgets.length === 0 ? (
        <Card>
          <EmptyState icon={<Wallet className="size-8" />} title={t("budgets.empty")} hint={t("budgets.emptyHint")} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {budgets.map((b) => (
            <RowMenu
              key={b.id}
              items={[
                { label: t("common.edit"), icon: Pencil, onSelect: () => setEdit({ budget: b }) },
                "separator",
                { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => delBudget.mutate(b.id) },
              ]}
            >
              <div className="flex [&>*]:min-w-0 [&>*]:flex-1">
                <BudgetCard budget={b} onClick={() => setEdit({ budget: b })} />
              </div>
            </RowMenu>
          ))}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.budget ? t("budgets.edit") : t("budgets.new")}>
        {edit && <BudgetForm key={edit.budget?.id ?? "new"} budget={edit.budget} onDone={() => setEdit(null)} />}
      </Dialog>
    </div>
  );
}

export function BudgetCard({ budget: b, onClick, compact }: { budget: Budget; onClick?: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const category = (useCategories().data ?? []).find((c) => c.id === b.categoryId);
  const tone = budgetTone(b);
  const Wrapper = onClick ? "button" : "div";

  return (
    <Card className={compact ? "border-0 bg-transparent" : undefined}>
      <Wrapper
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={`flex w-full flex-col gap-2.5 text-left ${compact ? "py-1.5" : "p-4"} ${onClick ? "rounded-xl hover:bg-surface-2/60 active:scale-100" : ""}`}
      >
        <div className="flex items-center gap-3">
          <CategoryIcon category={category} className={compact ? "size-7" : undefined} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{category ? displayName(category) : "—"}</span>
              {!compact && <Badge>{t(`budgets.period_${b.period}`)}</Badge>}
            </div>
            {!compact && (
              <div className="text-[12px] text-muted">
                {b.daysLeft > 0 ? t("budgets.daysLeft", { count: b.daysLeft }) : t("budgets.lastDay")}
              </div>
            )}
          </div>
          <div className="text-right">
            <Money minor={b.spentMinor} currency={b.currency} className="font-semibold" />
            <span className="text-[12px] text-muted">
              {" "}/ <Money minor={b.limitMinor} currency={b.currency} fractionClassName="hidden" />
            </span>
          </div>
        </div>
        <ProgressBar value={b.progress} tone={tone} color={tone === "ok" ? category?.color ?? undefined : undefined} />
        {!compact && (
          <div className="flex justify-between text-[12px]">
            <span className={tone === "over" ? "font-medium text-expense" : "text-muted"}>
              {b.remainingMinor >= 0 ? (
                <>
                  <Money minor={b.remainingMinor} currency={b.currency} /> {t("budgets.left")}
                </>
              ) : (
                <>
                  <Money minor={-b.remainingMinor} currency={b.currency} /> {t("budgets.over")}
                </>
              )}
            </span>
            <span className={b.projectedMinor > b.limitMinor ? "text-warn" : "text-muted"}>
              {t("budgets.projected")} <Money minor={b.projectedMinor} currency={b.currency} fractionClassName="hidden" /> ·{" "}
              {percent(b.progress)}
            </span>
          </div>
        )}
      </Wrapper>
    </Card>
  );
}

function BudgetForm({ budget, onDone }: { budget?: Budget; onDone: () => void }) {
  const { t } = useTranslation();
  const currency = useAppInfo().data?.defaultCurrency ?? "EUR";
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? "");
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? "month");
  const [limit, setLimit] = useState(budget ? minorToInput(budget.limitMinor, budget.currency, activeLocale()) : "");
  const [invalid, setInvalid] = useState(false);
  const save = useAppMutation(planning.upsertBudget, { success: t("common.saved") });
  const del = useAppMutation(planning.deleteBudget, { success: t("common.deleted") });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const limitMinor = parseMoney(limit, currency);
    if (limitMinor === null || !categoryId) {
      setInvalid(limitMinor === null);
      return;
    }
    try {
      await save.mutateAsync({ id: budget?.id, categoryId, period, limitMinor });
      onDone();
    } catch {
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t("tx.category")} htmlFor="budget-cat">
        <CategorySelect id="budget-cat" value={categoryId} onChange={setCategoryId} kind="expense" allowNone={false} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("budgets.limit")} htmlFor="budget-limit">
          <MoneyInput id="budget-limit" value={limit} onChange={setLimit} currency={currency} invalid={invalid} />
        </Field>
        <Field label={t("budgets.period")} htmlFor="budget-period">
          <Select id="budget-period" value={period} onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}>
            {(["day", "week", "month", "year"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`budgets.period_${p}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormFooter
        onCancel={onDone}
        saving={save.isPending}
        saveDisabled={!categoryId}
        left={
          budget && (
            <ConfirmDeleteButton
              onConfirm={async () => {
                try {
                  await del.mutateAsync(budget.id);
                  onDone();
                } catch {
                }
              }}
            />
          )
        }
      />
    </form>
  );
}
