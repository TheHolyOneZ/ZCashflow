import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Money, MoneyInput, parseSignedMoney } from "@/components/ui/extra";
import { IconTile } from "@/components/category-icon";
import { api, type Account, type AccountKind } from "@/lib/api";
import { activeLocale, displayName } from "@/lib/i18n";
import { minorToInput } from "@/lib/money";
import { invalidateData, useAccounts, useErrorMessage } from "@/lib/queries";
import { useUi } from "@/stores/ui";

const KIND_ICON: Record<AccountKind, string> = {
  cash: "banknote",
  checking: "landmark",
  savings: "piggy-bank",
  credit: "receipt",
  other: "coins",
};

export function BalanceDialog({
  open,
  onOpenChange,
  only,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  only?: string;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("balance.title")} description={t("balance.intro")}>
      {open && <BalanceForm only={only} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function BalanceForm({ only, onDone }: { only?: string; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archived && (!only || a.id === only));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(accounts.map((a) => [a.id, minorToInput(a.balanceMinor, a.currency, activeLocale())])),
  );
  const [busy, setBusy] = useState(false);

  const changed = (a: Account) => {
    const v = parseSignedMoney(values[a.id] ?? "", a.currency);
    return v !== null && v !== a.balanceMinor ? v : null;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let n = 0;
      for (const a of accounts) {
        const v = changed(a);
        if (v !== null) {
          await api.setAccountBalance(a.id, v);
          n++;
        }
      }
      await invalidateData(qc);
      if (n) toast(t("balance.saved"));
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {accounts.map((a, i) => {
          const entered = parseSignedMoney(values[a.id] ?? "", a.currency);
          return (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <IconTile icon={KIND_ICON[a.kind]} color={a.color ?? "var(--accent)"} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{displayName(a)}</div>
                <div className="text-[10.5px] leading-relaxed text-muted">
                  <div>
                    {t("balance.recorded")}: <Money minor={a.balanceMinor} currency={a.currency} />
                  </div>
                  {entered !== null && (
                    <>
                      <div>
                        {t("balance.entered")}: <Money minor={entered} currency={a.currency} />
                      </div>
                      <div>
                        {t("balance.difference")}: <Money minor={entered - a.balanceMinor} currency={a.currency} signed tone="auto" className="font-medium" />
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="w-36 shrink-0">
                <MoneyInput
                  value={values[a.id] ?? ""}
                  onChange={(v) => setValues((s) => ({ ...s, [a.id]: v }))}
                  currency={a.currency}
                  allowNegative
                  autoFocus={i === 0}
                  className="h-10 text-[15px] font-semibold"
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-muted">{t("balance.hint")}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !accounts.some((a) => changed(a) !== null)}>
          {t("balance.save")}
        </Button>
      </div>
    </form>
  );
}
