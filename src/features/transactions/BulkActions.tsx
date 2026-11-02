import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Landmark, Shapes, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { TimeInput } from "@/components/ui/time-input";
import { Field } from "@/components/ui/field";
import { AccountSelect, CategorySelect } from "@/components/selects";
import { api, type BulkChange, type Transaction } from "@/lib/api";
import { isoDate } from "@/lib/dates";
import { normalizeTime } from "@/lib/time";
import { invalidateData, useErrorMessage } from "@/lib/queries";
import { useUi } from "@/stores/ui";

type Action = "category" | "date" | "account" | "delete";

export function BulkBar({
  selected,
  items,
  onChange,
}: {
  selected: Set<string>;
  items: Transaction[];
  onChange: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const [action, setAction] = useState<Action | null>(null);
  const picked = items.filter((i) => selected.has(i.id));
  const all = items.length > 0 && items.every((i) => selected.has(i.id));
  const buttons: { action: Action; label: string; icon: typeof Shapes; danger?: boolean }[] = [
    { action: "category", label: t("tx.category"), icon: Shapes },
    { action: "date", label: t("tx.date"), icon: CalendarDays },
    { action: "account", label: t("tx.account"), icon: Landmark },
    { action: "delete", label: t("common.delete"), icon: Trash2, danger: true },
  ];

  return (
    <>
      <div
        role="toolbar"
        aria-label={t("bulk.selected", { count: selected.size })}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-wrap items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.35)] data-[state=open]:animate-[pop-in_140ms_var(--ease-out)] md:bottom-6"
      >
        <Button variant="ghost" size="icon" aria-label={t("bulk.clear")} onClick={() => onChange(new Set())}>
          <X className="size-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-[13px] font-semibold">{t("bulk.selected", { count: selected.size })}</span>
        <Button variant="ghost" size="sm" onClick={() => onChange(all ? new Set() : new Set(items.map((i) => i.id)))}>
          {all ? t("bulk.none") : t("bulk.all")}
        </Button>
        <div className="flex w-full justify-between gap-1 sm:w-auto">
          {buttons.map((b) => (
            <Button
              key={b.action}
              variant="ghost"
              size="sm"
              onClick={() => setAction(b.action)}
              className={b.danger ? "text-expense hover:text-expense" : undefined}
            >
              <b.icon className="size-4" />
              <span>{b.label}</span>
            </Button>
          ))}
        </div>
      </div>
      <Dialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action === "delete" ? t("bulk.deleteTitle", { count: picked.length }) : t("bulk.editTitle", { count: picked.length })}
      >
        {action && (
          <BulkForm
            action={action}
            items={picked}
            onDone={(clear) => {
              setAction(null);
              if (clear) onChange(new Set());
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function BulkForm({ action, items, onDone }: { action: Action; items: Transaction[]; onDone: (clear: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const kinds = new Set(items.map((i) => i.kind));
  const single = kinds.size === 1 ? [...kinds][0] : undefined;
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(() => (new Set(items.map((i) => i.occurredOn)).size === 1 ? items[0].occurredOn : isoDate()));
  const [time, setTime] = useState("");
  const [timeError, setTimeError] = useState(false);
  const [accountId, setAccountId] = useState(() => (new Set(items.map((i) => i.accountId)).size === 1 ? items[0].accountId : ""));
  const [busy, setBusy] = useState(false);
  const ids = items.map((i) => i.id);
  const transfers = items.filter((i) => i.kind === "transfer").length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    let change: BulkChange = {};
    if (action === "category") change = { setCategory: true, categoryId: categoryId || null };
    if (action === "account") change = { accountId };
    if (action === "date") {
      const normalized = normalizeTime(time);
      if (normalized === null) {
        setTimeError(true);
        return;
      }
      change = normalized ? { occurredOn: date, setTime: true, occurredTime: normalized } : { occurredOn: date };
    }
    setBusy(true);
    try {
      if (action === "delete") {
        const n = await api.deleteTransactions(ids);
        toast(t("bulk.deleted", { count: n }));
      } else {
        const r = await api.bulkUpdateTransactions(ids, change);
        toast(r.skipped ? t("bulk.updatedSkipped", { count: r.updated, skipped: r.skipped }) : t("bulk.updated", { count: r.updated }));
      }
      await invalidateData(qc);
      onDone(true);
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {action === "category" && (
        <Field label={t("tx.category")} htmlFor="bulk-category" hint={transfers ? t("bulk.transfersKeep") : undefined}>
          <CategorySelect id="bulk-category" value={categoryId} onChange={setCategoryId} kind={single === "transfer" ? undefined : single} />
        </Field>
      )}
      {action === "date" && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("tx.date")} htmlFor="bulk-date" className="min-w-0 flex-1">
            <DateInput id="bulk-date" required value={date} onChange={setDate} />
          </Field>
          <Field label={t("tx.time")} htmlFor="bulk-time" hint={t("bulk.timeKeep")}>
            <TimeInput
              id="bulk-time"
              value={time}
              invalid={timeError}
              onChange={(v) => {
                setTime(v);
                setTimeError(false);
              }}
              className="w-[7.5rem]"
            />
          </Field>
        </div>
      )}
      {action === "account" && (
        <Field label={t("tx.account")} htmlFor="bulk-account" hint={t("bulk.accountHint")}>
          <AccountSelect id="bulk-account" value={accountId} onChange={setAccountId} />
        </Field>
      )}
      {action === "delete" && <p className="text-[13px] text-muted">{t("bulk.deleteText", { count: items.length })}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={() => onDone(false)}>{t("common.cancel")}</Button>
        <Button
          type="submit"
          variant={action === "delete" ? "danger" : "primary"}
          disabled={busy || (action === "account" && !accountId) || (action === "date" && !date)}
        >
          {action === "delete" ? t("common.delete") : t("bulk.apply", { count: items.length })}
        </Button>
      </div>
    </form>
  );
}
