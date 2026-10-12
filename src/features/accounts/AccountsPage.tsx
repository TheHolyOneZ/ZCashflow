import type { ReactElement } from "react";
import { Archive, Pencil, Trash2, Plus, Scale } from "lucide-react";
import { BalanceDialog } from "./BalanceDialog";
import { RowMenu, type MenuEntry } from "@/components/ui/context-menu";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Card, PageHeader } from "@/components/ui/misc";
import {
  Badge,
  ColorSwatches,
  ConfirmDeleteButton,
  FormFooter,
  Money,
  MoneyInput,
  SwitchRow,
  parseSignedMoney,
} from "@/components/ui/extra";
import { IconTile } from "@/components/category-icon";
import { StatTile } from "@/components/stat-tile";
import { api, planning, type Account, type AccountKind } from "@/lib/api";
import { activeLocale, displayName } from "@/lib/i18n";
import { minorToInput } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { useAccounts, useAppInfo, useAppMutation } from "@/lib/queries";

const KIND_ICON: Record<AccountKind, string> = {
  cash: "banknote",
  checking: "landmark",
  savings: "piggy-bank",
  credit: "receipt",
  other: "coins",
};

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "PLN", "CZK", "SEK", "NOK", "DKK", "TRY", "JPY"];

export function AccountsPage() {
  const { t } = useTranslation();
  const accounts = useAccounts().data ?? [];
  const currency = useAppInfo().data?.defaultCurrency ?? "EUR";
  const [edit, setEdit] = useState<{ account?: Account } | null>(null);
  const [correct, setCorrect] = useState<{ only?: string } | null>(null);

  const active = accounts.filter((a) => !a.archived);
  const total = active.filter((a) => a.currency === currency).reduce((s, a) => s + a.balanceMinor, 0);
  const liquid = active
    .filter((a) => a.currency === currency && (a.kind === "cash" || a.kind === "checking" || a.kind === "credit"))
    .reduce((s, a) => s + a.balanceMinor, 0);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("nav.accounts")}
        subtitle={t("accounts.subtitle")}
        actions={
          <>
            <Button onClick={() => setCorrect({})}>
              <Scale className="size-4" />
              <span className="hidden sm:inline">{t("balance.title")}</span>
            </Button>
            <Button variant="primary" onClick={() => setEdit({})}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("accounts.new")}</span>
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={t("accounts.netWorth")}>
          <Money minor={total} currency={currency} tone="auto" />
        </StatTile>
        <StatTile label={t("accounts.liquid")} hint={t("accounts.liquidHint")}>
          <Money minor={liquid} currency={currency} tone="auto" />
        </StatTile>
      </div>
      <Distribution accounts={active.filter((a) => a.currency === currency)} currency={currency} />
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {accounts.map((a) => (
            <AccountMenu key={a.id} account={a} onEdit={() => setEdit({ account: a })} onCorrect={() => setCorrect({ only: a.id })}>
            <li>
              <button
                type="button"
                onClick={() => setEdit({ account: a })}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 active:scale-100 ${a.archived ? "opacity-55" : ""}`}
              >
                <IconTile icon={KIND_ICON[a.kind]} color={a.color ?? "var(--accent)"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{displayName(a)}</span>
                    {a.archived && <Badge>{t("common.archived")}</Badge>}
                  </div>
                  <div className="text-[12px] text-muted">
                    {t(`account.kinds.${a.kind}`)} · {a.currency}
                  </div>
                </div>
                <Money minor={a.balanceMinor} currency={a.currency} tone="auto" className="font-semibold" />
              </button>
            </li>
            </AccountMenu>
          ))}
        </ul>
      </Card>
      <BalanceDialog open={!!correct} onOpenChange={(o) => !o && setCorrect(null)} only={correct?.only} />
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.account ? t("accounts.edit") : t("accounts.new")}>
        {edit && <AccountForm key={edit.account?.id ?? "new"} account={edit.account} onDone={() => setEdit(null)} />}
      </Dialog>
    </div>
  );
}

function AccountForm({ account, onDone }: { account?: Account; onDone: () => void }) {
  const { t } = useTranslation();
  const defaultCurrency = useAppInfo().data?.defaultCurrency ?? "EUR";
  const [name, setName] = useState(account ? displayName(account) : "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "checking");
  const [currency, setCurrency] = useState(account?.currency ?? defaultCurrency);
  const [opening, setOpening] = useState(
    account ? minorToInput(account.openingMinor, account.currency, activeLocale()) : "",
  );
  const [color, setColor] = useState<string | null>(account?.color ?? "#2563eb");
  const [archived, setArchived] = useState(account?.archived ?? false);
  const save = useAppMutation(api.upsertAccount, { success: t("common.saved") });
  const del = useAppMutation(planning.deleteAccount, { success: t("common.deleted") });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({
        id: account?.id,
        name,
        kind,
        currency,
        openingMinor: opening.trim() ? (parseSignedMoney(opening, currency) ?? 0) : 0,
        color,
        archived,
      });
      onDone();
    } catch {
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t("accounts.name")} htmlFor="acc-name">
        <Input id="acc-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("accounts.namePlaceholder")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("accounts.kind")} htmlFor="acc-kind">
          <Select id="acc-kind" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {(["cash", "checking", "savings", "credit", "other"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`account.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("settings.currency")} htmlFor="acc-currency">
          <Select id="acc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!!account}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      {account?.anchorOn ? (
        <p className="rounded-xl bg-surface-2/60 px-3.5 py-2.5 text-[12.5px] text-muted">
          {t("balance.anchored", { date: formatDay(account.anchorOn) })}
        </p>
      ) : (
        <Field label={t("accounts.opening")} htmlFor="acc-opening" hint={t("accounts.openingHint")}>
          <MoneyInput id="acc-opening" value={opening} onChange={setOpening} currency={currency} allowNegative />
        </Field>
      )}
      <Field label={t("common.color")}>
        <ColorSwatches value={color} onChange={setColor} />
      </Field>
      {account && <SwitchRow label={t("common.archive")} hint={t("accounts.archiveHint")} checked={archived} onCheckedChange={setArchived} />}
      <FormFooter
        onCancel={onDone}
        saving={save.isPending}
        left={
          account && (
            <ConfirmDeleteButton
              onConfirm={async () => {
                try {
                  await del.mutateAsync(account.id);
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

function Distribution({ accounts, currency }: { accounts: Account[]; currency: string }) {
  const { t } = useTranslation();
  const positive = accounts.filter((a) => a.balanceMinor > 0).sort((a, b) => b.balanceMinor - a.balanceMinor);
  const sum = positive.reduce((s, a) => s + a.balanceMinor, 0);
  if (positive.length < 2 || sum <= 0) return null;
  return (
    <Card className="px-4 py-4">
      <div className="mb-3 text-[12px] font-medium text-muted">{t("accounts.distribution")}</div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {positive.map((a) => (
          <div
            key={a.id}
            title={displayName(a)}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(a.balanceMinor / sum) * 100}%`, background: a.color ?? "var(--accent)" }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {positive.map((a) => (
          <li key={a.id} className="flex items-center gap-1.5 text-[12px]">
            <span className="size-2 rounded-full" style={{ background: a.color ?? "var(--accent)" }} />
            <span className="text-muted">{displayName(a)}</span>
            <span className="font-medium tabular-nums">{Math.round((a.balanceMinor / sum) * 100)} %</span>
            <Money minor={a.balanceMinor} currency={currency} className="hidden text-muted sm:inline" fractionClassName="hidden" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AccountMenu({
  account: a,
  onEdit,
  onCorrect,
  children,
}: {
  account: Account;
  onEdit: () => void;
  onCorrect: () => void;
  children: ReactElement;
}) {
  const { t } = useTranslation();
  const archive = useAppMutation(
    () =>
      api.upsertAccount({
        id: a.id,
        name: a.name,
        kind: a.kind,
        currency: a.currency,
        openingMinor: a.openingMinor,
        color: a.color,
        archived: !a.archived,
      }),
    { success: t("common.saved") },
  );
  const del = useAppMutation(planning.deleteAccount, { success: t("common.deleted") });
  const items: MenuEntry[] = [
    { label: t("common.edit"), icon: Pencil, onSelect: onEdit },
    { label: t("balance.title"), icon: Scale, onSelect: onCorrect },
    { label: a.archived ? t("menu.unarchive") : t("common.archive"), icon: Archive, onSelect: () => archive.mutate(undefined) },
    "separator",
    { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => del.mutate(a.id) },
  ];
  return <RowMenu items={items}>{children}</RowMenu>;
}
