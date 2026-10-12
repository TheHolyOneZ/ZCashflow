import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { Money, MoneyInput, SwitchRow } from "@/components/ui/extra";
import { api, planning, type Transaction } from "@/lib/api";
import { activeLocale } from "@/lib/i18n";
import { minorToInput, parseMoney } from "@/lib/money";
import { invalidateData, useErrorMessage, useRecurring } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { ruleInput } from "@/features/recurring/rule-input";

const CHECKED_KEY = "zc.incomeChecked";

function readChecked(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(CHECKED_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

function markChecked(id: string) {
  try {
    const next = [...readChecked(), id].slice(-200);
    localStorage.setItem(CHECKED_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

export function IncomeCheck({ entries }: { entries: Transaction[] }) {
  const [checked, setChecked] = useState(readChecked);
  const open = entries.filter((e) => e.kind === "income" && e.recurringRuleId && !checked.has(e.id));
  if (open.length === 0) return null;
  return (
    <>
      {open.map((e) => (
        <IncomeRow
          key={e.id}
          tx={e}
          onDone={() => {
            markChecked(e.id);
            setChecked(readChecked());
          }}
        />
      ))}
    </>
  );
}

function IncomeRow({ tx, onDone }: { tx: Transaction; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const rule = (useRecurring().data ?? []).find((r) => r.id === tx.recurringRuleId);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(() => minorToInput(tx.amountMinor, tx.currency, activeLocale()));
  const [future, setFuture] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    const minor = parseMoney(amount, tx.currency);
    if (minor === null || minor <= 0) return;
    setBusy(true);
    try {
      if (minor !== tx.amountMinor) {
        await api.updateTransaction(tx.id, {
          kind: tx.kind,
          amountMinor: minor,
          occurredOn: tx.occurredOn,
          accountId: tx.accountId,
          toAccountId: tx.toAccountId,
          categoryId: tx.categoryId,
          counterparty: tx.counterpartyName,
          title: tx.title,
          note: tx.note,
          tags: tx.tags,
          debtId: tx.debtId,
          goalId: tx.goalId,
        });
        if (future && rule) await planning.upsertRecurring(ruleInput(rule, { amountMinor: minor }));
        await invalidateData(qc);
        toast(t("today.incomeSaved"));
      }
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden border-income/35">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-income/12 text-income">
          <Wallet className="size-4.5" />
        </span>
        <div className="min-w-[12rem] flex-1">
          <div className="text-[13.5px] font-medium">
            {t("today.incomeArrived", { title: tx.title || rule?.title || t("kind.income") })}
          </div>
          <div className="text-[12px] text-muted">
            {t("today.incomeBooked")} <Money minor={tx.amountMinor} currency={tx.currency} className="font-medium text-fg" />
            {" · "}
            {t("today.incomeQuestion")}
          </div>
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t("today.incomeOther")}
            </Button>
            <Button size="sm" variant="primary" onClick={onDone}>
              <Check className="size-3.5" strokeWidth={3} />
              {t("today.incomeFits")}
            </Button>
          </div>
        )}
      </div>
      {editing && (
        <div className="flex flex-col gap-3 border-t border-border bg-surface-2/40 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">
              <MoneyInput value={amount} onChange={setAmount} currency={tx.currency} className="h-10 text-[16px] font-semibold" />
            </div>
            <Button variant="primary" disabled={busy} onClick={save} className="h-10">
              {t("common.save")}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)} className="h-10">
              {t("common.cancel")}
            </Button>
          </div>
          {rule && (
            <SwitchRow label={t("tx.applyToRule")} hint={t("tx.applyToRuleHint")} checked={future} onCheckedChange={setFuture} />
          )}
        </div>
      )}
    </Card>
  );
}
