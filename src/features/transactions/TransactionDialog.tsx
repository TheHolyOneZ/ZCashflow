import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Paperclip, Plus, Repeat, Trash2 } from "lucide-react";
import { planning, receipts } from "@/lib/api";
import { SwitchRow, Money } from "@/components/ui/extra";
import { freqLabel } from "@/lib/format";
import { ruleInput } from "@/features/recurring/rule-input";
import { AccountSelect, CategorySelect, CounterpartyInput } from "@/components/selects";
import { useAttachments } from "@/lib/queries";
import { IMAGE_ACCEPT, Lightbox, ReceiptThumb, useReceiptImport } from "@/features/receipts/receipt-ui";
import type { Attachment } from "@/lib/api";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { TimeInput } from "@/components/ui/time-input";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import type { Transaction, TransactionInput, TxKind } from "@/lib/api";
import { activeLocale } from "@/lib/i18n";
import { entryTime, isoDate } from "@/lib/dates";
import { normalizeTime } from "@/lib/time";
import { minorToInput, parseMoney } from "@/lib/money";
import { useQueryClient } from "@tanstack/react-query";
import {
  invalidateData,
  useAccounts,
  useRecurring,
  useDeleteTransaction,
  useSaveTransaction,
} from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { cn } from "@/lib/cn";

interface FormState {
  kind: TxKind;
  amount: string;
  title: string;
  occurredOn: string;
  time: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  counterparty: string;
  note: string;
  tags: string;
}

function initialState(
  source: { editing: Transaction } | { draft: Partial<TransactionInput> },
  fallbackAccount: string,
): FormState {
  if ("editing" in source) {
    const tx = source.editing;
    return {
      kind: tx.kind,
      amount: minorToInput(tx.amountMinor, tx.currency, activeLocale()),
      title: tx.title,
      occurredOn: tx.occurredOn,
      time: tx.occurredTime ?? "",
      accountId: tx.accountId,
      toAccountId: tx.toAccountId ?? "",
      categoryId: tx.categoryId ?? "",
      counterparty: tx.counterpartyName ?? "",
      note: tx.note ?? "",
      tags: tx.tags.join(", "),
    };
  }
  const d = source.draft;
  const occurredOn = d.occurredOn ?? isoDate();
  return {
    kind: d.kind ?? "expense",
    amount: d.amountMinor ? minorToInput(d.amountMinor, "EUR", activeLocale()) : "",
    title: d.title ?? "",
    occurredOn,
    time: d.occurredTime ?? entryTime(occurredOn) ?? "",
    accountId: d.accountId ?? fallbackAccount,
    toAccountId: d.toAccountId ?? "",
    categoryId: d.categoryId ?? "",
    counterparty: d.counterparty ?? "",
    note: d.note ?? "",
    tags: (d.tags ?? []).join(", "),
  };
}

export function TransactionDialog() {
  const { t } = useTranslation();
  const state = useUi((s) => s.txDialog);
  const close = useUi((s) => s.closeTx);
  const editing = state.open && "editing" in state ? state.editing : null;

  return (
    <Dialog
      open={state.open}
      onOpenChange={(o) => !o && close()}
      title={editing ? t("tx.editTitle") : t("tx.new")}
      description={editing ? `${t("tx.ref")}: ${editing.ref}` : undefined}
    >
      {state.open && <TransactionForm key={editing?.id ?? "new"} source={state} onDone={close} />}
    </Dialog>
  );
}

function TransactionForm({
  source,
  onDone,
}: {
  source: { editing: Transaction } | { draft: Partial<TransactionInput> };
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const accounts = useAccounts().data ?? [];
  const save = useSaveTransaction();
  const del = useDeleteTransaction();
  const editing = "editing" in source ? source.editing : null;

  const activeAccounts = accounts.filter((a) => !a.archived || a.id === editing?.accountId);
  const [form, setForm] = useState<FormState>(() =>
    initialState(source, activeAccounts[0]?.id ?? ""),
  );
  const [showMore, setShowMore] = useState(
    () => !!(editing?.note || editing?.tags.length) || ("draft" in source && !!source.draft.note),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [amountError, setAmountError] = useState(false);
  const [timeError, setTimeError] = useState(false);
  const [timeTouched, setTimeTouched] = useState(!!editing || ("draft" in source && source.draft.occurredTime !== undefined));
  const rule = (useRecurring().data ?? []).find((r) => r.id === editing?.recurringRuleId);
  const [applyToRule, setApplyToRule] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!form.accountId && activeAccounts[0]) {
      setForm((f) => ({ ...f, accountId: activeAccounts[0].id }));
    }
  }, [activeAccounts, form.accountId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const account = accounts.find((a) => a.id === form.accountId);
  const currency = account?.currency ?? "EUR";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amountMinor = parseMoney(form.amount, currency);
    if (amountMinor === null) {
      setAmountError(true);
      document.getElementById("tx-amount")?.focus();
      return;
    }
    const time = normalizeTime(form.time);
    if (time === null) {
      setTimeError(true);
      document.getElementById("tx-time")?.focus();
      return;
    }
    const input: TransactionInput = {
      kind: form.kind,
      amountMinor,
      occurredOn: form.occurredOn,
      occurredTime: time || null,
      accountId: form.accountId,
      toAccountId: form.kind === "transfer" ? form.toAccountId || null : null,
      categoryId: form.kind === "transfer" ? null : form.categoryId || null,
      counterparty: form.counterparty.trim() || null,
      title: form.title.trim(),
      note: form.note.trim() || null,
      tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
      debtId: editing?.debtId ?? null,
      goalId: editing?.goalId ?? null,
    };
    try {
      await save.mutateAsync({ id: editing?.id, input });
      if (rule && applyToRule && amountMinor !== rule.amountMinor) {
        await planning.upsertRecurring(ruleInput(rule, { amountMinor }));
        await invalidateData(qc);
      }
    } catch {
      return;
    }
    toast(t("tx.saved"));
    onDone();
  }

  async function remove() {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await del.mutateAsync(editing.id);
    } catch {
      return;
    }
    toast(t("tx.deleted"));
    onDone();
  }

  const kindAccent: Record<TxKind, string> = {
    expense: "text-expense",
    income: "text-income",
    transfer: "text-transfer",
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Segmented
        aria-label={t("tx.new")}
        value={form.kind}
        onChange={(v) => set("kind", v)}
        className="w-full"
        options={(["expense", "income", "transfer"] as const).map((k) => ({
          value: k,
          label: t(`kind.${k}`),
          className: kindAccent[k],
        }))}
      />

      <div className="grid grid-cols-[1fr_auto] items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Field label={t("tx.amount")} htmlFor="tx-amount" className="col-span-2 sm:col-span-1">
          <div className="relative">
            <Input
              id="tx-amount"
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={form.amount}
              aria-invalid={amountError}
              onChange={(e) => {
                set("amount", e.target.value);
                setAmountError(false);
              }}
              className={cn(
                "tabular h-12 pr-14 text-2xl font-semibold",
                amountError && "border-expense focus:border-expense",
              )}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] font-medium text-muted">
              {currency}
            </span>
          </div>
          {amountError && (
            <span role="alert" className="text-[12px] text-expense">
              {t("errors.amountRequired")}
            </span>
          )}
        </Field>
        <Field label={t("tx.date")} htmlFor="tx-date">
          <DateInput
            id="tx-date"
            required
            value={form.occurredOn}
            onChange={(v) =>
              setForm((f) => ({ ...f, occurredOn: v, time: timeTouched ? f.time : (entryTime(v) ?? "") }))
            }
            className="h-12 sm:w-[10.5rem]"
          />
        </Field>
        <Field label={t("tx.time")} htmlFor="tx-time">
          <TimeInput
            id="tx-time"
            value={form.time}
            invalid={timeError}
            onChange={(v) => {
              setTimeTouched(true);
              setTimeError(false);
              set("time", v);
            }}
            className="h-12 w-[7.5rem]"
          />
          {timeError && (
            <span role="alert" className="text-[12px] text-expense">
              {t("tx.timeInvalid")}
            </span>
          )}
        </Field>
      </div>

      {rule && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/50 px-3.5 py-3">
          <div className="flex items-center gap-2 text-[12.5px]">
            <Repeat className="size-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              {t("tx.fromRule", { title: rule.title, freq: freqLabel(t, rule.freq, rule.intervalN) })}
            </span>
            {parseMoney(form.amount, currency) !== rule.amountMinor && (
              <span className="shrink-0 text-muted">
                {t("tx.usually")} <Money minor={rule.amountMinor} currency={rule.currency} />
              </span>
            )}
          </div>
          {parseMoney(form.amount, currency) !== null && parseMoney(form.amount, currency) !== rule.amountMinor && (
            <SwitchRow
              label={t("tx.applyToRule")}
              hint={t("tx.applyToRuleHint")}
              checked={applyToRule}
              onCheckedChange={setApplyToRule}
            />
          )}
        </div>
      )}

      <Field label={t("tx.title")} htmlFor="tx-title">
        <Input
          id="tx-title"
          placeholder={t("tx.titlePlaceholder")}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("tx.account")} htmlFor="tx-account">
          <AccountSelect id="tx-account" value={form.accountId} onChange={(v) => set("accountId", v)} includeId={editing?.accountId} />
        </Field>

        {form.kind === "transfer" ? (
          <Field label={t("tx.toAccount")} htmlFor="tx-to-account">
            <AccountSelect id="tx-to-account" value={form.toAccountId} onChange={(v) => set("toAccountId", v)} exclude={form.accountId} />
          </Field>
        ) : (
          <Field label={t("tx.category")} htmlFor="tx-category">
            <CategorySelect id="tx-category" value={form.categoryId} onChange={(v) => set("categoryId", v)} kind={form.kind} />
          </Field>
        )}
      </div>

      <Field label={t("tx.counterparty")} htmlFor="tx-counterparty">
        <CounterpartyInput
          id="tx-counterparty"
          value={form.counterparty}
          onChange={(v) => set("counterparty", v)}
          onBlur={async (v) => {
            if (form.categoryId || form.kind === "transfer" || !v.trim()) return;
            const id = await receipts.suggestCategory(v).catch(() => null);
            if (id) setForm((f) => (f.categoryId ? f : { ...f, categoryId: id }));
          }}
        />
      </Field>

      <button
        type="button"
        onClick={() => setShowMore((s) => !s)}
        aria-expanded={showMore}
        className="-my-1 flex w-fit items-center gap-1 rounded text-[12px] font-medium text-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", showMore && "rotate-180")} />
        {showMore ? t("common.less") : t("common.more")}
      </button>

      {showMore && (
        <div className="flex flex-col gap-3">
          <Field label={t("tx.note")} htmlFor="tx-note" hint={t("common.optional")}>
            <Textarea
              id="tx-note"
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
            />
          </Field>
          <Field label={t("tx.tags")} htmlFor="tx-tags" hint={t("tx.tagsPlaceholder")}>
            <Input id="tx-tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
          </Field>
        </div>
      )}

      {editing && <TxAttachments transactionId={editing.id} />}

      <div className="flex items-center gap-2 pt-1">
        {editing && (
          <Button
            variant={confirmDelete ? "danger" : "ghost"}
            onClick={remove}
            disabled={del.isPending}
            onBlur={() => setConfirmDelete(false)}
          >
            <Trash2 className="size-4" />
            {confirmDelete ? t("tx.deleteConfirm", { title: editing.title || t("tx.untitled") }) : t("common.delete")}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={save.isPending || !form.accountId}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function TxAttachments({ transactionId }: { transactionId: string }) {
  const { t } = useTranslation();
  const list = useAttachments({ transactionId }).data ?? [];
  const importFiles = useReceiptImport();
  const [view, setView] = useState<Attachment | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-[12px] font-medium text-muted">
        <Paperclip className="size-3" />
        {list.length ? t("receipts.attached", { count: list.length }) : t("receipts.attach")}
      </span>
      <div className="flex flex-wrap gap-2">
        {list.map((a) => (
          <ReceiptThumb key={a.id} attachment={a} onClick={() => setView(a)} className="size-16 cursor-zoom-in" />
        ))}
        <label className="flex size-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-muted hover:border-accent hover:text-accent">
          <Plus className="size-4" />
          <span className="sr-only">{t("receipts.attach")}</span>
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) importFiles(e.target.files, { transactionId });
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <Lightbox attachment={view} onClose={() => setView(null)} />
    </div>
  );
}
