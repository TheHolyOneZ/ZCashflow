import { useTranslation } from "react-i18next";
import { Select } from "@/components/ui/field";
import type { SelectItem } from "@/components/ui/select";
import { Money } from "@/components/ui/extra";
import { CategoryIcon, IconTile } from "@/components/category-icon";
import { Autocomplete, Stepper } from "@/components/ui/inputs";
import type { Freq, TxKind } from "@/lib/api";
import { categoryTree } from "@/lib/categories";
import { displayName } from "@/lib/i18n";
import { useAccounts, useCategories, useCounterparties, useRecentTitles } from "@/lib/queries";

const ACCOUNT_ICON: Record<string, string> = {
  cash: "banknote",
  checking: "landmark",
  savings: "piggy-bank",
  credit: "receipt",
  other: "coins",
};

export function AccountSelect({
  id,
  value,
  onChange,
  exclude,
  includeId,
}: {
  id?: string;
  value: string;
  onChange: (id: string) => void;
  exclude?: string;

  includeId?: string;
  required?: boolean;
}) {
  const accounts = (useAccounts().data ?? []).filter(
    (a) => (!a.archived || a.id === includeId) && a.id !== exclude,
  );
  const items: SelectItem[] = accounts.map((a) => ({
    value: a.id,
    label: displayName(a),
    text: displayName(a),
    icon: <IconTile icon={ACCOUNT_ICON[a.kind]} color={a.color ?? "var(--accent)"} className="size-6 rounded-md" iconClassName="size-3.5" />,
    hint: (
      <Money minor={a.balanceMinor} currency={a.currency} />
    ),
  }));
  return <Select id={id} value={value} onValueChange={onChange} items={items} />;
}

export function CategorySelect({
  id,
  value,
  onChange,
  kind,
  allowNone = true,
  noneLabel,
}: {
  id?: string;
  value: string;
  onChange: (id: string) => void;
  kind?: TxKind;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const { t } = useTranslation();
  const categories = (useCategories().data ?? []).filter(
    (c) => !kind || c.kind === "both" || c.kind === kind || c.id === value,
  );
  const item = (c: (typeof categories)[number], depth: number): SelectItem => ({
    value: c.id,
    label: displayName(c),
    text: displayName(c),
    depth,
    icon: <CategoryIcon category={c} className="size-6 rounded-md [&_svg]:size-3.5" />,
  });
  const items: SelectItem[] = [
    ...(allowNone
      ? [{ value: "", label: noneLabel ?? t("category.uncategorized"), icon: <CategoryIcon className="size-6 rounded-md [&_svg]:size-3.5" /> }]
      : []),
    ...categoryTree(categories).map((n) => item(n.category, n.depth)),
  ];
  return <Select id={id} value={value} onValueChange={onChange} items={items} placeholder={t("category.choose")} />;
}

export function CounterpartyInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const counterparties = useCounterparties().data ?? [];
  return (
    <Autocomplete
      id={id}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder ?? t("tx.counterpartyPlaceholder")}
      suggestions={counterparties.map((c) => c.name)}
    />
  );
}

export function TitleInput({
  id,
  value,
  onChange,
  onPick,
  kind,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onPick?: (v: string) => void;
  kind?: TxKind;
  placeholder?: string;
}) {
  const titles = useRecentTitles(kind).data ?? [];
  const counterparties = useCounterparties().data ?? [];
  const seen = new Set(titles.map((s) => s.toLowerCase()));
  const suggestions = [...titles, ...counterparties.map((c) => c.name).filter((n) => !seen.has(n.toLowerCase()))];
  return <Autocomplete id={id} value={value} onChange={onChange} onPick={onPick} placeholder={placeholder} suggestions={suggestions} />;
}

export function FreqPicker({
  freq,
  interval,
  onChange,
}: {
  freq: Freq;
  interval: number;
  onChange: (freq: Freq, interval: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-muted">{t("freq.every")}</span>
      <Stepper aria-label={t("freq.interval")} value={interval} min={1} max={99} onChange={(n) => onChange(freq, n)} className="w-28" />
      <Select
        aria-label={t("freq.unit")}
        value={freq}
        onChange={(e) => onChange(e.target.value as Freq, interval)}
        className="flex-1"
      >
        {(["daily", "weekly", "monthly", "yearly"] as const).map((f) => (
          <option key={f} value={f}>
            {t(`freq.unit_${f}`, { count: interval })}
          </option>
        ))}
      </Select>
    </div>
  );
}
