import { RowMenu, type MenuEntry } from "@/components/ui/context-menu";
import { Pencil, Trash2, CalendarClock, Download, Plus } from "lucide-react";
import { Tip } from "@/components/ui/inputs";
import { useExportFile } from "@/features/data/export";
import { planning } from "@/lib/api";
import { useAppMutation, useAccounts, useAppInfo, useCategories, useRecurring, useUpcoming } from "@/lib/queries";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/misc";
import { Badge, Money } from "@/components/ui/extra";
import { Segmented } from "@/components/ui/segmented";
import { CategoryIcon } from "@/components/category-icon";
import type { RecurringRule, TxKind } from "@/lib/api";
import { formatDay, formatTime } from "@/lib/dates";
import { daysFromToday, freqLabel, relativeDays } from "@/lib/format";
import { displayName } from "@/lib/i18n";
import { StatTile } from "@/components/stat-tile";
import { PendingList } from "./PendingList";
import { RecurringDialog } from "./RecurringDialog";

type Filter = "all" | TxKind;

export function RecurringPage() {
  const { t } = useTranslation();
  const rules = useRecurring().data ?? [];
  const pending = (useUpcoming(0).data ?? []).filter((o) => o.overdue && !o.autoPost);
  const currency = useAppInfo().data?.mainCurrency ?? "EUR";
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<{ rule?: RecurringRule } | null>(null);
  const exportFile = useExportFile();

  const totals = useMemo(() => {
    const active = rules.filter((r) => r.nextOn && r.currency === currency);
    const expense = active.filter((r) => r.kind === "expense").reduce((s, r) => s + r.monthlyMinor, 0);
    const income = active.filter((r) => r.kind === "income").reduce((s, r) => s + r.monthlyMinor, 0);
    return { expense, income, free: income - expense };
  }, [rules, currency]);

  const visible = rules.filter((r) => filter === "all" || r.kind === filter);
  const active = visible.filter((r) => r.nextOn);
  const ended = visible.filter((r) => !r.nextOn);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("nav.recurring")}
        subtitle={t("recurring.subtitle")}
        actions={
          <>
            <Tip label={t("dataTransfer.exportRecurring")}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("dataTransfer.exportRecurring")}
                disabled={!rules.length}
                onClick={() => exportFile({ datasets: ["recurring"] }, "zcashflow-recurring")}
              >
                <Download className="size-4" />
              </Button>
            </Tip>
            <Button variant="primary" onClick={() => setDialog({})}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("recurring.new")}</span>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
        <StatTile label={t("recurring.fixedPerMonth")} hint={<Yearly minor={totals.expense} currency={currency} />}>
          <Money minor={totals.expense} currency={currency} />
        </StatTile>
        <StatTile label={t("recurring.incomePerMonth")} hint={<Yearly minor={totals.income} currency={currency} />}>
          <Money minor={totals.income} currency={currency} className="text-income" />
        </StatTile>
        <StatTile label={t("recurring.leftPerMonth")} hint={t("recurring.leftHint")}>
          <Money minor={totals.free} currency={currency} signed tone="auto" />
        </StatTile>
      </div>

      {pending.length > 0 && (
        <Card className="overflow-hidden border-warn/40">
          <CardHeader title={t("recurring.pendingTitle", { count: pending.length })} />
          <PendingList items={pending} />
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <Segmented<Filter>
            aria-label={t("common.filter")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("common.all") },
              { value: "expense", label: t("kind.expenses") },
              { value: "income", label: t("kind.incomes") },
              { value: "transfer", label: t("kind.transfers") },
            ]}
          />
          <span className="hidden text-[12px] text-muted sm:block">
            {t("recurring.count", { count: active.length })}
          </span>
        </div>
        {visible.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-8" />}
            title={t("recurring.empty")}
            hint={t("recurring.emptyHint")}
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {active.map((r) => (
                <RuleRow key={r.id} rule={r} onClick={() => setDialog({ rule: r })} />
              ))}
            </ul>
            {ended.length > 0 && (
              <>
                <h3 className="border-y border-border bg-surface-2/50 px-4 py-1.5 text-[12px] font-medium text-muted">
                  {t("recurring.ended")}
                </h3>
                <ul className="divide-y divide-border opacity-60">
                  {ended.map((r) => (
                    <RuleRow key={r.id} rule={r} onClick={() => setDialog({ rule: r })} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </Card>

      <RecurringDialog open={!!dialog} rule={dialog?.rule} onClose={() => setDialog(null)} />
    </div>
  );
}

function Yearly({ minor, currency }: { minor: number; currency: string }) {
  const { t } = useTranslation();
  return (
    <>
      <Money minor={minor * 12} currency={currency} fractionClassName="hidden" /> {t("recurring.perYear")}
    </>
  );
}

function RuleRow({ rule, onClick }: { rule: RecurringRule; onClick: () => void }) {
  const { t } = useTranslation();
  const category = (useCategories().data ?? []).find((c) => c.id === rule.categoryId);
  const account = (useAccounts().data ?? []).find((a) => a.id === rule.accountId);
  const days = rule.nextOn ? daysFromToday(rule.nextOn) : null;
  const sign = rule.kind === "expense" ? -1 : 1;
  const del = useAppMutation(planning.deleteRecurring, { success: t("common.deleted") });
  const menu: MenuEntry[] = [
    { label: t("common.edit"), icon: Pencil, onSelect: onClick },
    "separator",
    { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => del.mutate(rule.id) },
  ];

  return (
    <RowMenu items={menu}>
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none active:scale-100"
      >
        <CategoryIcon category={category} kind={rule.kind} debt={!!rule.debtId} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{rule.title}</span>
            {!rule.autoPost && <Badge>{t("recurring.manual")}</Badge>}
            {rule.debtId && <Badge tone="warn">{t("nav.debts")}</Badge>}
          </div>
          <div className="truncate text-[12px] text-muted">
            {freqLabel(t, rule.freq, rule.intervalN)}
            {rule.nextOn && days !== null && (
              <>
                {" · "}
                <span className={days <= 3 ? "font-medium text-fg" : undefined}>
                  {t("recurring.next")} {days <= 7 ? relativeDays(days) : formatDay(rule.nextOn)}
                  {rule.occurredTime && `, ${formatTime(rule.occurredTime)}`}
                </span>
              </>
            )}
            {account && ` · ${displayName(account)}`}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <Money
            flow
            minor={sign * rule.amountMinor}
            currency={rule.currency}
            signed={rule.kind === "income"}
            className={rule.kind === "income" ? "font-semibold text-income" : rule.kind === "transfer" ? "font-semibold text-transfer" : "font-semibold"}
          />
          {rule.freq !== "monthly" || rule.intervalN !== 1 ? (
            <span className="text-[11px] text-muted">
              ≈ <Money minor={rule.monthlyMinor} currency={rule.currency} /> / {t("recurring.month")}
            </span>
          ) : null}
        </div>
      </button>
    </li>
    </RowMenu>
  );
}
