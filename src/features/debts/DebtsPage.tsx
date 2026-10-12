import { Trash2, HandCoins, Pencil, Plus } from "lucide-react";
import { RowMenu } from "@/components/ui/context-menu";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import {
  Badge,
  ConfirmDeleteButton,
  FormFooter,
  Money,
  MoneyInput,
  ProgressBar,
  SwitchRow,
} from "@/components/ui/extra";
import { AccountSelect, CounterpartyInput, FreqPicker } from "@/components/selects";
import { StatTile } from "@/components/stat-tile";
import { planning, type Debt, type DebtDirection, type Freq } from "@/lib/api";
import { formatDay, isoDate } from "@/lib/dates";
import { daysFromToday, freqLabel, relativeDays } from "@/lib/format";
import { activeLocale } from "@/lib/i18n";
import { minorToInput, parseMoney } from "@/lib/money";
import { useAccounts, useAppInfo, useAppMutation, useDebts } from "@/lib/queries";
import { cn } from "@/lib/cn";

export function DebtsPage() {
  const { t } = useTranslation();
  const debts = useDebts().data ?? [];
  const currency = useAppInfo().data?.defaultCurrency ?? "EUR";
  const [direction, setDirection] = useState<DebtDirection>("i_owe");
  const [edit, setEdit] = useState<{ debt?: Debt } | null>(null);
  const [pay, setPay] = useState<Debt | null>(null);
  const delDebt = useAppMutation(planning.deleteDebt, { success: t("common.deleted") });

  const open = debts.filter((d) => !d.archived && d.remainingMinor > 0);
  const sum = (dir: DebtDirection) =>
    open.filter((d) => d.direction === dir && d.currency === currency).reduce((s, d) => s + d.remainingMinor, 0);
  const next = open
    .filter((d) => d.direction === "i_owe" && d.nextPaymentOn && d.installment)
    .sort((a, b) => a.nextPaymentOn!.localeCompare(b.nextPaymentOn!))[0];

  const visible = debts.filter((d) => d.direction === direction);
  const active = visible.filter((d) => !d.archived && d.remainingMinor > 0);
  const done = visible.filter((d) => d.archived || d.remainingMinor === 0);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("nav.debts")}
        subtitle={t("debts.subtitle")}
        actions={
          <Button variant="primary" onClick={() => setEdit({})}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("debts.new")}</span>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
        <StatTile label={t("debts.iOweTotal")}>
          <Money minor={sum("i_owe")} currency={currency} className={sum("i_owe") > 0 ? "text-expense" : undefined} />
        </StatTile>
        <StatTile label={t("debts.owedToMeTotal")}>
          <Money minor={sum("owed_to_me")} currency={currency} className="text-income" />
        </StatTile>
        <StatTile
          label={t("debts.nextInstallment")}
          hint={next ? `${next.title} · ${relativeDays(daysFromToday(next.nextPaymentOn!))}` : t("debts.noInstallment")}
        >
          {next?.installment ? <Money minor={next.installment.amountMinor} currency={next.currency} /> : "—"}
        </StatTile>
      </div>

      <Segmented<DebtDirection>
        aria-label={t("debts.direction")}
        value={direction}
        onChange={setDirection}
        className="w-fit"
        options={[
          { value: "i_owe", label: t("debts.iOwe") },
          { value: "owed_to_me", label: t("debts.owedToMe") },
        ]}
      />

      {active.length === 0 && done.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HandCoins className="size-8" />}
            title={direction === "i_owe" ? t("debts.emptyIOwe") : t("debts.emptyOwed")}
            hint={t("debts.emptyHint")}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {active.map((d) => (
            <RowMenu
              key={d.id}
              items={[
                { label: t("common.edit"), icon: Pencil, onSelect: () => setEdit({ debt: d }) },
                { label: d.direction === "owed_to_me" ? t("debts.recordRepayment") : t("debts.recordPayment"), icon: HandCoins, onSelect: () => setPay(d) },
                "separator",
                { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => delDebt.mutate(d.id) },
              ]}
            >
              <div className="flex [&>*]:min-w-0 [&>*]:flex-1">
                <DebtCard debt={d} onEdit={() => setEdit({ debt: d })} onPay={() => setPay(d)} />
              </div>
            </RowMenu>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <h2 className="mt-2 text-[13px] font-semibold text-muted">{t("debts.done")}</h2>
          <div className="grid grid-cols-1 gap-3 opacity-70 lg:grid-cols-2">
            {done.map((d) => (
              <DebtCard key={d.id} debt={d} onEdit={() => setEdit({ debt: d })} />
            ))}
          </div>
        </>
      )}

      <Dialog
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.debt ? t("debts.edit") : t("debts.new")}
      >
        {edit && (
          <DebtForm key={edit.debt?.id ?? "new"} debt={edit.debt} direction={direction} onDone={() => setEdit(null)} />
        )}
      </Dialog>

      <Dialog
        open={!!pay}
        onOpenChange={(o) => !o && setPay(null)}
        title={pay?.direction === "owed_to_me" ? t("debts.recordRepayment") : t("debts.recordPayment")}
        description={pay?.title}
      >
        {pay && <PaymentForm key={pay.id} debt={pay} onDone={() => setPay(null)} />}
      </Dialog>
    </div>
  );
}

function DebtCard({ debt: d, onEdit, onPay }: { debt: Debt; onEdit: () => void; onPay?: () => void }) {
  const { t } = useTranslation();
  const dueDays = d.dueOn ? daysFromToday(d.dueOn) : null;
  const progress = d.principalMinor > 0 ? d.paidMinor / d.principalMinor : 0;
  const owe = d.direction === "i_owe";

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{d.title}</h3>
            {d.remainingMinor === 0 ? (
              <Badge tone="income">{t("debts.paidOff")}</Badge>
            ) : dueDays !== null && dueDays < 0 ? (
              <Badge tone="expense">{t("debts.overdue")}</Badge>
            ) : dueDays !== null && dueDays <= 14 ? (
              <Badge tone="warn">{relativeDays(dueDays)}</Badge>
            ) : null}
          </div>
          {d.counterpartyName && <p className="truncate text-[12px] text-muted">{d.counterpartyName}</p>}
        </div>
        <Button size="icon" variant="ghost" onClick={onEdit} aria-label={t("common.edit")} className="-mt-1 -mr-2 size-8">
          <Pencil className="size-3.5" />
        </Button>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <Money
            minor={d.remainingMinor}
            currency={d.currency}
            className={cn("text-2xl font-semibold tracking-tight", owe ? "text-fg" : "text-income")}
          />
          <span className="text-[12px] text-muted">
            {t("debts.ofTotal")} <Money minor={d.principalMinor} currency={d.currency} />
          </span>
        </div>
        <ProgressBar value={progress} className="mt-2" color={owe ? "var(--accent)" : "var(--income)"} />
        <p className="mt-1.5 text-[12px] text-muted">
          {t("debts.paidCount", { count: d.paymentCount })} · <Money minor={d.paidMinor} currency={d.currency} />
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
        {d.installment && (
          <>
            <dt className="text-muted">{t("debts.installment")}</dt>
            <dd className="text-right">
              <Money minor={d.installment.amountMinor} currency={d.currency} /> ·{" "}
              {freqLabel(t, d.installment.freq, d.installment.intervalN)}
            </dd>
          </>
        )}
        {d.nextPaymentOn && d.remainingMinor > 0 && (
          <>
            <dt className="text-muted">{t("debts.nextPayment")}</dt>
            <dd className="text-right">{formatDay(d.nextPaymentOn)}</dd>
          </>
        )}
        {d.dueOn && (
          <>
            <dt className="text-muted">{t("debts.dueOn")}</dt>
            <dd className="text-right">{formatDay(d.dueOn)}</dd>
          </>
        )}
        {d.payoffOn && d.remainingMinor > 0 && (
          <>
            <dt className="text-muted">{t("debts.payoffOn")}</dt>
            <dd className="text-right font-medium">{formatDay(d.payoffOn, { month: "long", year: "numeric" })}</dd>
          </>
        )}
      </dl>

      {onPay && d.remainingMinor > 0 && (
        <Button onClick={onPay} className="w-full justify-center">
          <HandCoins className="size-4" />
          {owe ? t("debts.recordPayment") : t("debts.recordRepayment")}
        </Button>
      )}
    </Card>
  );
}

function DebtForm({ debt, direction: initialDirection, onDone }: { debt?: Debt; direction: DebtDirection; onDone: () => void }) {
  const { t } = useTranslation();
  const accounts = useAccounts().data ?? [];
  const defaultCurrency = useAppInfo().data?.defaultCurrency ?? "EUR";
  const currency = debt?.currency ?? defaultCurrency;
  const loc = activeLocale();
  const inst = debt?.installment;

  const [direction, setDirection] = useState<DebtDirection>(debt?.direction ?? initialDirection);
  const [title, setTitle] = useState(debt?.title ?? "");
  const [counterparty, setCounterparty] = useState(debt?.counterpartyName ?? "");
  const [principal, setPrincipal] = useState(debt ? minorToInput(debt.principalMinor, currency, loc) : "");
  const [startOn, setStartOn] = useState(debt?.startOn ?? isoDate());
  const [dueOn, setDueOn] = useState(debt?.dueOn ?? "");
  const [note, setNote] = useState(debt?.note ?? "");
  const [archived, setArchived] = useState(debt?.archived ?? false);
  const [hasPlan, setHasPlan] = useState(!!inst);
  const [rate, setRate] = useState(inst ? minorToInput(inst.amountMinor, currency, loc) : "");
  const [freq, setFreq] = useState<Freq>(inst?.freq ?? "monthly");
  const [intervalN, setIntervalN] = useState(inst?.intervalN ?? 1);
  const [planStart, setPlanStart] = useState(inst?.startOn ?? isoDate());
  const [accountId, setAccountId] = useState(inst?.accountId ?? accounts.find((a) => !a.archived)?.id ?? "");
  const [autoPost, setAutoPost] = useState(inst?.autoPost ?? true);
  const [errors, setErrors] = useState<{ principal?: boolean; rate?: boolean }>({});

  const save = useAppMutation(planning.upsertDebt, { success: t("common.saved") });
  const del = useAppMutation(planning.deleteDebt, { success: t("common.deleted") });

  const principalMinor = parseMoney(principal, currency);
  const rateMinor = parseMoney(rate, currency);
  const rateCount = principalMinor && rateMinor ? Math.ceil(principalMinor / rateMinor) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs = { principal: principalMinor === null, rate: hasPlan && rateMinor === null };
    setErrors(errs);
    if (errs.principal || errs.rate) return;
    try {
      await save.mutateAsync({
        id: debt?.id,
        title,
        direction,
        counterparty: counterparty.trim() || null,
        principalMinor: principalMinor!,
        currency,
        startOn,
        dueOn: dueOn || null,
        note: note.trim() || null,
        archived,
        installment: hasPlan
          ? { amountMinor: rateMinor!, freq, intervalN, startOn: planStart, accountId, autoPost }
          : null,
      });
      onDone();
    } catch {
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Segmented<DebtDirection>
        aria-label={t("debts.direction")}
        value={direction}
        onChange={setDirection}
        className="w-full"
        options={[
          { value: "i_owe", label: t("debts.iOwe") },
          { value: "owed_to_me", label: t("debts.owedToMe") },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_11rem]">
        <Field label={t("tx.title")} htmlFor="debt-title">
          <Input
            id="debt-title"
            required
            autoFocus
            placeholder={t("debts.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("debts.amount")} htmlFor="debt-amount">
          <MoneyInput id="debt-amount" value={principal} onChange={setPrincipal} currency={currency} invalid={errors.principal} />
        </Field>
      </div>
      <Field label={direction === "i_owe" ? t("debts.creditor") : t("debts.debtor")} htmlFor="debt-cp">
        <CounterpartyInput id="debt-cp" value={counterparty} onChange={setCounterparty} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("debts.since")} htmlFor="debt-start">
          <DateInput id="debt-start" required value={startOn} onChange={setStartOn} />
        </Field>
        <Field label={t("debts.dueOn")} htmlFor="debt-due" hint={t("common.optional")}>
          <DateInput clearable id="debt-due" value={dueOn} onChange={setDueOn} />
        </Field>
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-surface-2/60 p-3">
        <SwitchRow
          label={t("debts.plan")}
          hint={t("debts.planHint")}
          checked={hasPlan}
          onCheckedChange={setHasPlan}
        />
        {hasPlan && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("debts.installment")} htmlFor="debt-rate">
                <MoneyInput id="debt-rate" value={rate} onChange={setRate} currency={currency} invalid={errors.rate} />
              </Field>
              <Field label={t("debts.firstInstallment")} htmlFor="debt-plan-start">
                <DateInput id="debt-plan-start" value={planStart} onChange={setPlanStart} />
              </Field>
            </div>
            <FreqPicker
              freq={freq}
              interval={intervalN}
              onChange={(f, i) => {
                setFreq(f);
                setIntervalN(i);
              }}
            />
            <Field label={t("tx.account")} htmlFor="debt-account">
              <AccountSelect id="debt-account" value={accountId} onChange={setAccountId} includeId={inst?.accountId} />
            </Field>
            <SwitchRow label={t("recurring.autoPost")} checked={autoPost} onCheckedChange={setAutoPost} />
            {rateCount && (
              <p className="text-[12px] text-muted">{t("debts.planSummary", { count: rateCount })}</p>
            )}
          </>
        )}
      </div>

      <Field label={t("tx.note")} htmlFor="debt-note" hint={t("common.optional")}>
        <Textarea id="debt-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-14" />
      </Field>
      {debt && <SwitchRow label={t("common.archive")} checked={archived} onCheckedChange={setArchived} />}

      <FormFooter
        onCancel={onDone}
        saving={save.isPending}
        left={
          debt && (
            <ConfirmDeleteButton
              onConfirm={async () => {
                try {
                  await del.mutateAsync(debt.id);
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

function PaymentForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const { t } = useTranslation();
  const accounts = useAccounts().data ?? [];
  const suggested = Math.min(debt.installment?.amountMinor ?? debt.remainingMinor, debt.remainingMinor);
  const [amount, setAmount] = useState(minorToInput(suggested, debt.currency, activeLocale()));
  const [date, setDate] = useState(isoDate());
  const [accountId, setAccountId] = useState(
    debt.installment?.accountId ?? accounts.find((a) => !a.archived)?.id ?? "",
  );
  const [invalid, setInvalid] = useState(false);
  const pay = useAppMutation(
    (v: { amount: number }) => planning.recordDebtPayment(debt.id, v.amount, date, accountId),
    { success: t("common.saved") },
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const minor = parseMoney(amount, debt.currency);
    if (minor === null) {
      setInvalid(true);
      return;
    }
    try {
      await pay.mutateAsync({ amount: minor });
      onDone();
    } catch {
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">
        {t("debts.remaining")}: <Money minor={debt.remainingMinor} currency={debt.currency} className="font-medium text-fg" />
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
        <Field label={t("tx.amount")} htmlFor="pay-amount">
          <MoneyInput id="pay-amount" autoFocus value={amount} onChange={setAmount} currency={debt.currency} invalid={invalid} className="h-11 text-lg" />
        </Field>
        <Field label={t("tx.date")} htmlFor="pay-date">
          <DateInput id="pay-date" value={date} onChange={setDate} className="h-11" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => setAmount(minorToInput(debt.remainingMinor, debt.currency, activeLocale()))}>
          {t("debts.payAll")}
        </Button>
      </div>
      <Field label={t("tx.account")} htmlFor="pay-account">
        <AccountSelect id="pay-account" value={accountId} onChange={setAccountId} />
      </Field>
      <FormFooter onCancel={onDone} saving={pay.isPending} />
    </form>
  );
}
