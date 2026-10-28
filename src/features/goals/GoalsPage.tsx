import { Trash2, Minus, Pencil, PiggyBank, Plus } from "lucide-react";
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
  ColorSwatches,
  ConfirmDeleteButton,
  FormFooter,
  Money,
  MoneyInput,
  ProgressRing,
  SwitchRow,
} from "@/components/ui/extra";
import { IconPicker, IconTile } from "@/components/category-icon";
import { StatTile } from "@/components/stat-tile";
import { planning, type Goal } from "@/lib/api";
import { formatDay, isoDate } from "@/lib/dates";
import { percent } from "@/lib/format";
import { activeLocale } from "@/lib/i18n";
import { minorToInput, parseMoney } from "@/lib/money";
import { useAppInfo, useAppMutation, useGoalAllocations, useGoals } from "@/lib/queries";

export function GoalsPage() {
  const { t } = useTranslation();
  const goals = useGoals().data ?? [];
  const currency = useAppInfo().data?.mainCurrency ?? "EUR";
  const [edit, setEdit] = useState<{ goal?: Goal } | null>(null);
  const [allocate, setAllocate] = useState<Goal | null>(null);
  const delGoal = useAppMutation(planning.deleteGoal, { success: t("common.deleted") });

  const active = goals.filter((g) => !g.archived);
  const saved = active.filter((g) => g.currency === currency).reduce((s, g) => s + g.savedMinor, 0);
  const target = active.filter((g) => g.currency === currency).reduce((s, g) => s + g.targetMinor, 0);
  const monthly = active.reduce((s, g) => s + (g.monthlyNeededMinor ?? 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("nav.goals")}
        subtitle={t("goals.subtitle")}
        actions={
          <Button variant="primary" onClick={() => setEdit({})}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("goals.new")}</span>
          </Button>
        }
      />

      {active.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
          <StatTile label={t("goals.savedTotal")} hint={target > 0 ? `${percent(saved / target)} ${t("goals.ofAllGoals")}` : undefined}>
            <Money minor={saved} currency={currency} />
          </StatTile>
          <StatTile label={t("goals.stillNeeded")}>
            <Money minor={Math.max(0, target - saved)} currency={currency} />
          </StatTile>
          <StatTile label={t("goals.monthlyRate")} hint={t("goals.monthlyRateHint")}>
            <Money minor={monthly} currency={currency} className="text-accent" />
          </StatTile>
        </div>
      )}

      {goals.length === 0 ? (
        <Card>
          <EmptyState icon={<PiggyBank className="size-8" />} title={t("goals.empty")} hint={t("goals.emptyHint")} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((g) => (
            <RowMenu
              key={g.id}
              items={[
                { label: t("common.edit"), icon: Pencil, onSelect: () => setEdit({ goal: g }) },
                { label: t("goals.allocate"), icon: Plus, onSelect: () => setAllocate(g), disabled: g.archived },
                "separator",
                { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => delGoal.mutate(g.id) },
              ]}
            >
              <div className="flex [&>*]:min-w-0 [&>*]:flex-1">
                <GoalCard goal={g} onEdit={() => setEdit({ goal: g })} onAllocate={() => setAllocate(g)} />
              </div>
            </RowMenu>
          ))}
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.goal ? t("goals.edit") : t("goals.new")}>
        {edit && <GoalForm key={edit.goal?.id ?? "new"} goal={edit.goal} onDone={() => setEdit(null)} />}
      </Dialog>
      <Dialog
        open={!!allocate}
        onOpenChange={(o) => !o && setAllocate(null)}
        title={t("goals.allocate")}
        description={allocate?.title}
      >
        {allocate && <AllocateForm key={allocate.id} goal={allocate} onDone={() => setAllocate(null)} />}
      </Dialog>
    </div>
  );
}

function GoalCard({ goal: g, onEdit, onAllocate }: { goal: Goal; onEdit: () => void; onAllocate: () => void }) {
  const { t } = useTranslation();
  const color = g.color ?? "var(--accent)";
  const reached = g.remainingMinor === 0;

  return (
    <Card className={`flex flex-col gap-4 p-4 ${g.archived ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <ProgressRing value={g.progress} color={color} size={60}>
          <IconTile icon={g.icon ?? "piggy-bank"} color={color} className="size-9 bg-transparent" iconClassName="size-5" />
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{g.title}</h3>
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <Money minor={g.savedMinor} currency={g.currency} className="text-lg font-semibold" />
            <span className="text-[12px] text-muted">
              / <Money minor={g.targetMinor} currency={g.currency} fractionClassName="hidden" />
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone="accent">{percent(g.progress)}</Badge>
            {reached ? (
              <Badge tone="income">{t("goals.reached")}</Badge>
            ) : g.onTrack === true ? (
              <Badge tone="income">{t("goals.onTrack")}</Badge>
            ) : g.onTrack === false ? (
              <Badge tone="warn">{t("goals.behind")}</Badge>
            ) : null}
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={onEdit} aria-label={t("common.edit")} className="-mt-1 -mr-2 size-8">
          <Pencil className="size-3.5" />
        </Button>
      </div>

      {!reached && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          {g.targetOn && (
            <>
              <dt className="text-muted">{t("goals.targetOn")}</dt>
              <dd className="text-right">{formatDay(g.targetOn)}</dd>
            </>
          )}
          {g.monthlyNeededMinor !== null && (
            <>
              <dt className="text-muted">{t("goals.perMonth")}</dt>
              <dd className="text-right font-medium">
                <Money minor={g.monthlyNeededMinor} currency={g.currency} />
              </dd>
            </>
          )}
          <dt className="text-muted">{t("goals.pace")}</dt>
          <dd className="text-right">
            {g.avgMonthlyMinor > 0 ? (
              <>
                <Money minor={g.avgMonthlyMinor} currency={g.currency} /> / {t("recurring.month")}
              </>
            ) : (
              "—"
            )}
          </dd>
          {g.projectedOn && (
            <>
              <dt className="text-muted">{t("goals.projected")}</dt>
              <dd className="text-right">{formatDay(g.projectedOn, { month: "long", year: "numeric" })}</dd>
            </>
          )}
        </dl>
      )}

      {!g.archived && (
        <Button onClick={onAllocate} className="mt-auto w-full justify-center">
          <Plus className="size-4" />
          {t("goals.allocate")}
        </Button>
      )}
    </Card>
  );
}

function GoalForm({ goal, onDone }: { goal?: Goal; onDone: () => void }) {
  const { t } = useTranslation();
  const mainCurrency = useAppInfo().data?.mainCurrency;
  const currency = goal?.currency ?? mainCurrency ?? "EUR";
  const [title, setTitle] = useState(goal?.title ?? "");
  const [target, setTarget] = useState(goal ? minorToInput(goal.targetMinor, currency, activeLocale()) : "");
  const [targetOn, setTargetOn] = useState(goal?.targetOn ?? "");
  const [initial, setInitial] = useState("");
  const [color, setColor] = useState<string | null>(goal?.color ?? "#0f766e");
  const [icon, setIcon] = useState<string | null>(goal?.icon ?? "piggy-bank");
  const [note, setNote] = useState(goal?.note ?? "");
  const [archived, setArchived] = useState(goal?.archived ?? false);
  const [invalid, setInvalid] = useState(false);
  const save = useAppMutation(planning.upsertGoal, { success: t("common.saved") });
  const del = useAppMutation(planning.deleteGoal, { success: t("common.deleted") });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const targetMinor = parseMoney(target, currency);
    if (targetMinor === null) {
      setInvalid(true);
      return;
    }
    try {
      await save.mutateAsync({
        id: goal?.id,
        title,
        targetMinor,
        targetOn: targetOn || null,
        color,
        icon,
        note: note.trim() || null,
        archived,
        initialMinor: goal ? null : parseMoney(initial, currency),
      });
      onDone();
    } catch {
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t("tx.title")} htmlFor="goal-title">
        <Input id="goal-title" required autoFocus placeholder={t("goals.titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("goals.target")} htmlFor="goal-target">
          <MoneyInput id="goal-target" value={target} onChange={setTarget} currency={currency} invalid={invalid} />
        </Field>
        <Field label={t("goals.targetOn")} htmlFor="goal-date" hint={t("common.optional")}>
          <DateInput clearable id="goal-date" min={isoDate()} value={targetOn} onChange={setTargetOn} />
        </Field>
      </div>
      {!goal && (
        <Field label={t("goals.initial")} htmlFor="goal-initial" hint={t("common.optional")}>
          <MoneyInput id="goal-initial" value={initial} onChange={setInitial} currency={currency} />
        </Field>
      )}
      <Field label={t("common.color")}>
        <ColorSwatches value={color} onChange={setColor} />
      </Field>
      <Field label={t("common.icon")}>
        <IconPicker value={icon} color={color} onChange={setIcon} />
      </Field>
      <Field label={t("tx.note")} htmlFor="goal-note" hint={t("common.optional")}>
        <Textarea id="goal-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-14" />
      </Field>
      {goal && <SwitchRow label={t("common.archive")} checked={archived} onCheckedChange={setArchived} />}
      <FormFooter
        onCancel={onDone}
        saving={save.isPending}
        left={
          goal && (
            <ConfirmDeleteButton
              onConfirm={async () => {
                try {
                  await del.mutateAsync(goal.id);
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

function AllocateForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const { t } = useTranslation();
  const history = useGoalAllocations(goal.id).data ?? [];
  const [mode, setMode] = useState<"in" | "out">("in");
  const suggestion = goal.monthlyNeededMinor ?? 0;
  const [amount, setAmount] = useState(suggestion > 0 ? minorToInput(suggestion, goal.currency, activeLocale()) : "");
  const [date, setDate] = useState(isoDate());
  const [invalid, setInvalid] = useState(false);
  const save = useAppMutation(
    (v: { amount: number }) => planning.allocateGoal(goal.id, v.amount, date),
    { success: t("common.saved") },
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const minor = parseMoney(amount, goal.currency);
    if (minor === null) {
      setInvalid(true);
      return;
    }
    try {
      await save.mutateAsync({ amount: mode === "in" ? minor : -minor });
      onDone();
    } catch {
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Segmented
        aria-label={t("goals.allocate")}
        value={mode}
        onChange={setMode}
        className="w-full"
        options={[
          { value: "in", label: t("goals.deposit"), className: "text-income" },
          { value: "out", label: t("goals.withdraw"), className: "text-expense" },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
        <Field label={t("tx.amount")} htmlFor="alloc-amount">
          <MoneyInput id="alloc-amount" autoFocus value={amount} onChange={setAmount} currency={goal.currency} invalid={invalid} className="h-11 text-lg" />
        </Field>
        <Field label={t("tx.date")} htmlFor="alloc-date">
          <DateInput id="alloc-date" value={date} onChange={setDate} className="h-11" />
        </Field>
      </div>
      {mode === "in" && goal.remainingMinor > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestion > 0 && (
            <Button size="sm" onClick={() => setAmount(minorToInput(suggestion, goal.currency, activeLocale()))}>
              {t("goals.monthlyShare")}
            </Button>
          )}
          <Button size="sm" onClick={() => setAmount(minorToInput(goal.remainingMinor, goal.currency, activeLocale()))}>
            {t("goals.fillUp")}
          </Button>
        </div>
      )}
      {history.length > 0 && (
        <div>
          <h4 className="mb-1 text-[12px] font-medium text-muted">{t("goals.history")}</h4>
          <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {history.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-3 py-1.5 text-[13px]">
                <span className="flex items-center gap-1.5 text-muted">
                  {a.amountMinor < 0 ? <Minus className="size-3" /> : <Plus className="size-3" />}
                  {formatDay(a.occurredOn)}
                </span>
                <Money minor={a.amountMinor} currency={goal.currency} signed tone="auto" />
              </li>
            ))}
          </ul>
        </div>
      )}
      <FormFooter onCancel={onDone} saving={save.isPending} />
    </form>
  );
}
