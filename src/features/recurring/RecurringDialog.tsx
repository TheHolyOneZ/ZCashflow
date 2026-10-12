import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Stepper } from "@/components/ui/inputs";
import { ConfirmDeleteButton, FormFooter, MoneyInput, SwitchRow } from "@/components/ui/extra";
import { AccountSelect, CategorySelect, CounterpartyInput, FreqPicker } from "@/components/selects";
import { planning, type Freq, type RecurringRule, type TxKind } from "@/lib/api";
import { isoDate } from "@/lib/dates";
import { activeLocale } from "@/lib/i18n";
import { minorToInput, parseMoney } from "@/lib/money";
import { useAccounts, useAppMutation } from "@/lib/queries";

type EndMode = "never" | "date" | "count";

export function RecurringDialog({
  open,
  rule,
  defaults,
  onClose,
}: {
  open: boolean;
  rule?: RecurringRule | null;
  defaults?: { kind?: TxKind };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={rule ? t("recurring.edit") : t("recurring.new")}
      description={t("recurring.dialogHint")}
    >
      {open && <RecurringForm key={rule?.id ?? "new"} rule={rule ?? null} defaults={defaults} onDone={onClose} />}
    </Dialog>
  );
}

function RecurringForm({
  rule,
  defaults,
  onDone,
}: {
  rule: RecurringRule | null;
  defaults?: { kind?: TxKind };
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const accounts = useAccounts().data ?? [];
  const firstAccount = accounts.find((a) => !a.archived)?.id ?? "";

  const [kind, setKind] = useState<TxKind>(rule?.kind ?? defaults?.kind ?? "expense");
  const [amount, setAmount] = useState(
    rule ? minorToInput(rule.amountMinor, rule.currency, activeLocale()) : "",
  );
  const [title, setTitle] = useState(rule?.title ?? "");
  const [freq, setFreq] = useState<Freq>(rule?.freq ?? "monthly");
  const [interval, setIntervalN] = useState(rule?.intervalN ?? 1);
  const [startOn, setStartOn] = useState(rule?.startOn ?? isoDate());
  const [endMode, setEndMode] = useState<EndMode>(rule?.endOn ? "date" : rule?.maxCount ? "count" : "never");
  const [endOn, setEndOn] = useState(rule?.endOn ?? "");
  const [maxCount, setMaxCount] = useState(rule?.maxCount ?? 12);
  const [accountId, setAccountId] = useState(rule?.accountId ?? firstAccount);
  const [toAccountId, setToAccountId] = useState(rule?.toAccountId ?? "");
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? "");
  const [counterparty, setCounterparty] = useState(rule?.counterpartyName ?? "");
  const [autoPost, setAutoPost] = useState(rule?.autoPost ?? true);
  const [backfill, setBackfill] = useState(false);
  const [note, setNote] = useState(rule?.note ?? "");
  const [amountError, setAmountError] = useState(false);

  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "EUR";
  const save = useAppMutation(planning.upsertRecurring, { success: t("common.saved") });
  const del = useAppMutation(planning.deleteRecurring, { success: t("common.deleted") });
  const startsInPast = startOn < isoDate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amountMinor = parseMoney(amount, currency);
    if (amountMinor === null) {
      setAmountError(true);
      return;
    }
    try {
      await save.mutateAsync({
        id: rule?.id,
        title,
        kind,
        amountMinor,
        accountId: accountId || firstAccount,
        toAccountId: kind === "transfer" ? toAccountId || null : null,
        categoryId: kind === "transfer" ? null : categoryId || null,
        counterparty: counterparty.trim() || null,
        freq,
        intervalN: interval,
        startOn,
        endOn: endMode === "date" && endOn ? endOn : null,
        maxCount: endMode === "count" ? maxCount : null,
        autoPost,
        backfill: !rule && startsInPast && autoPost && backfill,
        note: note.trim() || null,
      });
      onDone();
    } catch {
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Segmented
        aria-label={t("tx.new")}
        value={kind}
        onChange={setKind}
        className="w-full"
        options={[
          { value: "expense", label: t("kind.expense"), className: "text-expense" },
          { value: "income", label: t("kind.income"), className: "text-income" },
          { value: "transfer", label: t("kind.transfer"), className: "text-transfer" },
        ]}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_11rem]">
        <Field label={t("tx.title")} htmlFor="rr-title">
          <Input
            id="rr-title"
            required
            autoFocus
            placeholder={t("recurring.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("tx.amount")} htmlFor="rr-amount">
          <MoneyInput
            id="rr-amount"
            value={amount}
            currency={currency}
            invalid={amountError}
            onChange={(v) => {
              setAmount(v);
              setAmountError(false);
            }}
          />
        </Field>
      </div>

      <Field label={t("recurring.rhythm")}>
        <FreqPicker
          freq={freq}
          interval={interval}
          onChange={(f, i) => {
            setFreq(f);
            setIntervalN(i);
          }}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10.5rem_1fr]">
        <Field label={t("recurring.firstOn")} htmlFor="rr-start">
          <DateInput id="rr-start" required value={startOn} onChange={setStartOn} />
        </Field>
        <Field label={t("recurring.ends")}>
          <div className="flex flex-col gap-2">
            <Segmented<EndMode>
              aria-label={t("recurring.ends")}
              value={endMode}
              onChange={setEndMode}
              className="w-full"
              options={[
                { value: "never", label: t("recurring.endNever") },
                { value: "date", label: t("recurring.endDate") },
                { value: "count", label: t("recurring.endCount") },
              ]}
            />
            {endMode === "date" && (
              <DateInput
                aria-label={t("recurring.endDate")}
                min={startOn}
                required
                value={endOn}
                onChange={setEndOn}
              />
            )}
            {endMode === "count" && (
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <Stepper aria-label={t("recurring.endCount")} value={maxCount} min={1} max={999} onChange={setMaxCount} className="w-32" />
                {t("recurring.times", { count: maxCount })}
              </div>
            )}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("tx.account")} htmlFor="rr-account">
          <AccountSelect id="rr-account" value={accountId} onChange={setAccountId} includeId={rule?.accountId} />
        </Field>
        {kind === "transfer" ? (
          <Field label={t("tx.toAccount")} htmlFor="rr-to">
            <AccountSelect id="rr-to" value={toAccountId} onChange={setToAccountId} exclude={accountId} required />
          </Field>
        ) : (
          <Field label={t("tx.category")} htmlFor="rr-category">
            <CategorySelect id="rr-category" value={categoryId} onChange={setCategoryId} kind={kind} />
          </Field>
        )}
      </div>

      <Field label={t("tx.counterparty")} htmlFor="rr-cp">
        <CounterpartyInput id="rr-cp" value={counterparty} onChange={setCounterparty} />
      </Field>

      <div className="flex flex-col gap-3 rounded-xl bg-surface-2/60 p-3">
        <SwitchRow
          label={t("recurring.autoPost")}
          hint={autoPost ? t("recurring.autoPostOn") : t("recurring.autoPostOff")}
          checked={autoPost}
          onCheckedChange={setAutoPost}
        />
        {!rule && startsInPast && autoPost && (
          <SwitchRow
            label={t("recurring.backfill")}
            hint={t("recurring.backfillHint")}
            checked={backfill}
            onCheckedChange={setBackfill}
          />
        )}
      </div>

      <Field label={t("tx.note")} htmlFor="rr-note" hint={t("common.optional")}>
        <Textarea id="rr-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-14" />
      </Field>

      <FormFooter
        onCancel={onDone}
        saving={save.isPending}
        left={
          rule && (
            <ConfirmDeleteButton
              disabled={del.isPending}
              onConfirm={async () => {
                try {
                  await del.mutateAsync(rule.id);
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
