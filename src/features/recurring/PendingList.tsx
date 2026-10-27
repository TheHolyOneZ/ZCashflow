import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/extra";
import { Tip } from "@/components/ui/inputs";
import { CategoryIcon } from "@/components/category-icon";
import { planning, type Occurrence } from "@/lib/api";
import { formatDay, formatTime } from "@/lib/dates";
import { activeLocale } from "@/lib/i18n";
import { minorToInput, parseMoney } from "@/lib/money";
import { useAppMutation, useCategories } from "@/lib/queries";
import { relativeDays, daysFromToday } from "@/lib/format";

export function PendingList({ items }: { items: Occurrence[] }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((o) => (
        <PendingRow key={`${o.ruleId}:${o.date}`} o={o} />
      ))}
    </ul>
  );
}

function PendingRow({ o }: { o: Occurrence }) {
  const { t } = useTranslation();
  const category = (useCategories().data ?? []).find((c) => c.id === o.categoryId);
  const [amount, setAmount] = useState(minorToInput(o.amountMinor, o.currency, activeLocale()));
  const confirm = useAppMutation(
    () => planning.confirmOccurrence(o.ruleId, o.date, parseMoney(amount, o.currency) ?? o.amountMinor),
    { success: t("recurring.confirmed") },
  );
  const skip = useAppMutation(() => planning.skipOccurrence(o.ruleId, o.date), {
    success: t("recurring.skipped"),
  });
  const busy = confirm.isPending || skip.isPending;
  const days = daysFromToday(o.date);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <CategoryIcon category={category} kind={o.kind} />
      <div className="min-w-[9rem] flex-1">
        <div className="truncate font-medium">{o.title}</div>
        <div className="text-[12px] text-muted">
          {formatDay(o.date)}
          {o.time && `, ${formatTime(o.time)}`} · {relativeDays(days)}
        </div>
      </div>
      <div className="flex w-full items-center gap-1.5 sm:w-auto">
        <div className="min-w-0 flex-1 sm:w-32 sm:flex-none">
          <MoneyInput value={amount} onChange={setAmount} currency={o.currency} className="h-8" />
        </div>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => confirm.mutate(undefined)}>
          <Check className="size-3.5" />
          {t("recurring.confirm")}
        </Button>
        <Tip label={t("recurring.skip")}>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => skip.mutate(undefined)} aria-label={t("recurring.skip")}>
            <SkipForward className="size-3.5" />
          </Button>
        </Tip>
      </div>
    </li>
  );
}
