import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Link2, ListTree, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Field, Input } from "@/components/ui/field";
import { Badge, ConfirmDeleteButton, Money, MoneyInput, parseSignedMoney, Switch } from "@/components/ui/extra";
import { AccountSelect, CategorySelect, CounterpartyInput } from "@/components/selects";
import { receipts, type Attachment, type Category, type LineItem, type Transaction } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDay, isoDate } from "@/lib/dates";
import { activeLocale } from "@/lib/i18n";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { displayName } from "@/lib/i18n";
import { CheckRow } from "@/features/data/CheckRow";
import { useAccounts, useAppMutation, useCategories, useTransactions } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { Lightbox, ReceiptThumb } from "./receipt-ui";

export function ReceiptReviewDialog() {
  const { t } = useTranslation();
  const receipt = useUi((s) => s.receipt);
  const close = useUi((s) => s.openReceipt);
  return (
    <Dialog
      open={!!receipt}
      onOpenChange={(o) => !o && close(null)}
      title={t("receipts.review")}
      description={t("receipts.reviewHint")}
      className="sm:max-w-3xl"
    >
      {receipt && <ReviewForm key={receipt.id} receipt={receipt} onDone={() => close(null)} />}
    </Dialog>
  );
}

function useMatches(amountMinor: number | null, date: string | null) {
  const from = date ? isoDate(new Date(new Date(date).getTime() - 5 * 86_400_000)) : undefined;
  const to = date ? isoDate(new Date(new Date(date).getTime() + 5 * 86_400_000)) : undefined;
  const { data = [] } = useTransactions(date ? { from, to, kind: "expense", limit: 200 } : { limit: 0 });
  return useMemo(
    () => (amountMinor ? data.filter((t) => t.amountMinor === amountMinor && t.attachmentCount === 0) : []),
    [data, amountMinor],
  );
}

interface ItemRow {
  key: number;
  name: string;
  amount: string;
  categoryId: string;
}

let itemSeq = 0;

function toRows(items: LineItem[] | undefined, categories: Category[], currency: string, loc: string): ItemRow[] {
  return (items ?? []).map((i) => ({
    key: ++itemSeq,
    name: i.name,
    amount: (i.amountMinor < 0 ? "-" : "") + minorToInput(Math.abs(i.amountMinor), currency, loc),
    categoryId: (i.categoryHint && categories.find((c) => c.systemKey === `category.${i.categoryHint}`)?.id) || "",
  }));
}

export interface SplitPart {
  categoryId: string | null;
  amountMinor: number;
  note: string | null;
}

export function splitParts(
  rows: { name: string; minor: number; categoryId: string }[],
  totalMinor: number,
  mainCategory: string,
  combine: boolean,
  restLabel: string,
  money: (minor: number) => string,
): SplitPart[] | null {
  const groups = new Map<string, { categoryId: string; minor: number; names: string[] }>();
  const add = (key: string, categoryId: string, minor: number, label: string) => {
    const g = groups.get(key) ?? { categoryId, minor: 0, names: [] };
    g.minor += minor;
    g.names.push(`${label} ${money(minor)}`);
    groups.set(key, g);
  };
  rows.forEach((r, i) => {
    const cat = r.categoryId || mainCategory;
    add(combine ? `c:${cat}` : `i:${i}`, cat, r.minor, r.name.trim() || "?");
  });
  const rest = totalMinor - rows.reduce((s, r) => s + r.minor, 0);
  if (rest !== 0) add(combine ? `c:${mainCategory}` : "rest", mainCategory, rest, restLabel);
  const parts = [...groups.values()];
  if (!parts.length || parts.some((p) => p.minor <= 0)) return null;
  return parts.map((p) => ({ categoryId: p.categoryId || null, amountMinor: p.minor, note: p.names.join(" · ") }));
}

function ReviewForm({ receipt: initial, onDone }: { receipt: Attachment; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const categories = useCategories().data ?? [];
  const accounts = useAccounts().data ?? [];
  const [receipt, setReceipt] = useState(initial);
  const ex = receipt.extracted;
  const loc = activeLocale();
  const itemSum = (ex?.items ?? []).reduce((s, i) => s + i.amountMinor, 0);
  const initialTotal = ex?.totalMinor ?? (itemSum > 0 ? itemSum : null);
  const [amount, setAmount] = useState(initialTotal ? minorToInput(initialTotal, ex?.currency ?? "EUR", loc) : "");
  const [split, setSplit] = useState(false);
  const [combine, setCombine] = useState(true);
  const [items, setItems] = useState<ItemRow[]>(() => toRows(ex?.items, categories, ex?.currency ?? "EUR", loc));
  const [date, setDate] = useState(ex?.date ?? isoDate());
  const [merchant, setMerchant] = useState(ex?.merchant ?? "");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState(accounts.find((a) => !a.archived)?.id ?? "");
  const [showText, setShowText] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!categories.length) return;
    const hint = ex?.categoryHint && categories.find((c) => c.systemKey === `category.${ex.categoryHint}`);
    if (hint) {
      setCategoryId((c) => c || hint.id);
      return;
    }
    if (ex?.merchant) {
      receipts
        .suggestCategory(ex.merchant)
        .then((id) => !cancelled && id && categories.some((c) => c.id === id) && setCategoryId((c) => c || id), () => {});
    }
    return () => {
      cancelled = true;
    };
  }, [ex?.categoryHint, ex?.merchant, categories]);

  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "EUR";
  const amountMinor = parseMoney(amount, currency);
  const matches = useMatches(amountMinor, date);

  const parsedItems = items
    .map((i) => ({ name: i.name, minor: parseSignedMoney(i.amount, currency), categoryId: i.categoryId }))
    .filter((i): i is { name: string; minor: number; categoryId: string } => i.minor !== null && i.minor !== 0);
  const itemsTotal = parsedItems.reduce((s, i) => s + i.minor, 0);
  const parts =
    split && amountMinor !== null
      ? splitParts(parsedItems, amountMinor, categoryId, combine, t("receipts.rest"), (m) => formatMoney(m, currency, loc))
      : null;
  const book = useAppMutation(
    (bookParts: SplitPart[]) =>
      receipts.book(receipt.id, {
        date,
        accountId,
        counterparty: merchant.trim() || null,
        title: title.trim() || merchant.trim(),
        parts: bookParts,
      }),
    { success: t("receipts.booked") },
  );
  const link = useAppMutation((tx: Transaction) => receipts.link(receipt.id, tx.id), { success: t("receipts.linked") });
  const del = useAppMutation(() => receipts.delete(receipt.id), { success: t("common.deleted") });
  const reprocess = useAppMutation(() => receipts.reprocess(receipt.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (amountMinor === null) {
      setInvalid(true);
      return;
    }
    if (split && !parts) {
      toast(t("receipts.splitInvalid"), "error");
      return;
    }
    try {
      await book.mutateAsync(split && parts ? parts : [{ categoryId: categoryId || null, amountMinor, note: null }]);
      onDone();
    } catch {
    }
  }

  async function rerun() {
    try {
      const updated = await reprocess.mutateAsync(undefined);
      setReceipt(updated);
      const x = updated.extracted;
      if (x?.totalMinor) setAmount(minorToInput(x.totalMinor, x.currency ?? currency, loc));
      if (x?.date) setDate(x.date);
      if (x?.merchant) setMerchant(x.merchant);
      if (x?.items?.length) setItems(toRows(x.items, categories, x.currency ?? currency, loc));
      toast(t("receipts.reprocessed"));
    } catch {
    }
  }

  const ocrFailed = receipt.ocrEngine?.startsWith("error");

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-[15rem_1fr]">
      <div className="flex flex-col gap-2">
        <ReceiptThumb attachment={receipt} onClick={() => setLightbox(true)} className="aspect-[3/4] w-full cursor-zoom-in" />
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {ex?.source === "llm" ? (
            <Badge tone="accent">
              <Sparkles className="size-3" /> {t("receipts.aiRefined")}
            </Badge>
          ) : receipt.ocrEngine && !ocrFailed ? (
            <Badge>{t("receipts.recognizedWith", { engine: receipt.ocrEngine })}</Badge>
          ) : (
            <Badge tone="warn">{t("receipts.noText")}</Badge>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={reprocess.isPending} onClick={rerun}>
            <RefreshCw className={cn("size-3", reprocess.isPending && "animate-spin")} />
            {t("receipts.rerun")}
          </Button>
        </div>
        {receipt.ocrText && (
          <div>
            <button
              type="button"
              onClick={() => setShowText((s) => !s)}
              className="flex items-center gap-1 text-[11px] font-medium text-muted hover:text-fg"
            >
              <ChevronDown className={cn("size-3 transition-transform", showText && "rotate-180")} />
              {t("receipts.ocrText")}
            </button>
            {showText && (
              <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-surface-2 p-2 font-mono text-[10px] leading-snug whitespace-pre-wrap">
                {receipt.ocrText}
              </pre>
            )}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {matches.length > 0 && (
          <div className="rounded-xl border border-accent/40 bg-accent-soft/60 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-accent">
              <Link2 className="size-3.5" />
              {t("receipts.matchFound", { count: matches.length })}
            </div>
            <ul className="flex flex-col gap-1.5">
              {matches.slice(0, 3).map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{m.title || m.counterpartyName}</span>
                    <span className="text-muted"> · {formatDay(m.occurredOn)} · </span>
                    <Money minor={m.amountMinor} currency={m.currency} />
                  </span>
                  <Button
                    size="sm"
                    disabled={link.isPending}
                    onClick={async () => {
                      try {
                        await link.mutateAsync(m);
                        onDone();
                      } catch {
                      }
                    }}
                  >
                    {t("receipts.link")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label={t("tx.amount")} htmlFor="rc-amount">
            <MoneyInput
              id="rc-amount"
              autoFocus
              value={amount}
              onChange={(v) => {
                setAmount(v);
                setInvalid(false);
              }}
              currency={currency}
              invalid={invalid}
              className="h-12 text-2xl font-semibold"
            />
          </Field>
          <Field label={t("tx.date")} htmlFor="rc-date">
            <DateInput id="rc-date" required value={date} onChange={setDate} className="h-12" />
          </Field>
        </div>
        <Field label={t("receipts.merchant")} htmlFor="rc-merchant">
          <CounterpartyInput id="rc-merchant" value={merchant} onChange={setMerchant} />
        </Field>
        <Field label={t("tx.title")} htmlFor="rc-title" hint={t("common.optional")}>
          <Input id="rc-title" value={title} placeholder={merchant || t("tx.titlePlaceholder")} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("tx.category")} htmlFor="rc-category">
            <CategorySelect id="rc-category" value={categoryId} onChange={setCategoryId} kind="expense" />
          </Field>
          <Field label={t("tx.account")} htmlFor="rc-account">
            <AccountSelect id="rc-account" value={accountId} onChange={setAccountId} />
          </Field>
        </div>
        <div className="rounded-xl border border-border">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <ListTree className="size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t("receipts.items", { count: items.length })}</div>
              <div className="text-[11px] text-muted">{t("receipts.itemsHint")}</div>
            </div>
            <Switch aria-label={t("receipts.splitItems")} checked={split} onCheckedChange={setSplit} />
          </div>
          {split && (
            <div className="flex flex-col gap-2 border-t border-border p-3">
              {items.length === 0 && <p className="text-[12px] text-muted">{t("receipts.noItems")}</p>}
              {items.map((it) => (
                <div key={it.key} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] gap-1.5 sm:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,11rem)_auto]">
                  <Input
                    aria-label={t("receipts.itemName")}
                    value={it.name}
                    placeholder={t("receipts.itemName")}
                    onChange={(e) => setItems((list) => list.map((x) => (x.key === it.key ? { ...x, name: e.target.value } : x)))}
                    className="h-8 text-[13px]"
                  />
                  <MoneyInput
                    value={it.amount}
                    allowNegative
                    currency={currency}
                    onChange={(v) => setItems((list) => list.map((x) => (x.key === it.key ? { ...x, amount: v } : x)))}
                    className="h-8 pr-10 text-[13px]"
                  />
                  <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                    <CategorySelect
                      value={it.categoryId}
                      kind="expense"
                      noneLabel={t("receipts.sameAsMain", { category: mainLabel(categories, categoryId, t("category.uncategorized")) })}
                      onChange={(v) => setItems((list) => list.map((x) => (x.key === it.key ? { ...x, categoryId: v } : x)))}
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={t("common.delete")}
                    onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => setItems((list) => [...list, { key: ++itemSeq, name: "", amount: "", categoryId: "" }])}
              >
                <Plus className="size-3.5" />
                {t("receipts.addItem")}
              </Button>
              <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-[12px]">
                <span className="text-muted">
                  {t("receipts.itemsSum")} <Money minor={itemsTotal} currency={currency} className="font-medium text-fg" />
                </span>
                {amountMinor !== null && amountMinor !== itemsTotal && (
                  <span className={amountMinor - itemsTotal < 0 ? "text-expense" : "text-muted"}>
                    {t("receipts.restToMain", { category: mainLabel(categories, categoryId, t("category.uncategorized")) })}{" "}
                    <Money minor={amountMinor - itemsTotal} currency={currency} signed className="font-medium" />
                  </span>
                )}
              </div>
              <CheckRow checked={combine} onChange={() => setCombine((c) => !c)} label={t("receipts.combine")} hint={t("receipts.combineHint")} className="-mx-2.5" />
              {parts ? (
                <div className="flex flex-wrap gap-1.5">
                  {parts.map((p, i) => (
                    <Badge key={i} tone="accent">
                      {mainLabel(categories, p.categoryId ?? "", t("category.uncategorized"))} · <Money minor={p.amountMinor} currency={currency} />
                    </Badge>
                  ))}
                </div>
              ) : (
                amountMinor !== null && <p className="text-[12px] text-expense">{t("receipts.splitInvalid")}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ConfirmDeleteButton
            onConfirm={async () => {
              try {
                await del.mutateAsync(undefined);
                onDone();
              } catch {
              }
            }}
          />
          <div className="ml-auto flex gap-2">
            <Button onClick={onDone}>{t("receipts.later")}</Button>
            <Button type="submit" variant="primary" disabled={book.isPending || !accountId}>
              {split && parts && parts.length > 1 ? t("receipts.bookParts", { count: parts.length }) : t("receipts.book")}
            </Button>
          </div>
        </div>
      </form>
      <Lightbox attachment={lightbox ? receipt : null} onClose={() => setLightbox(false)} />
    </div>
  );
}

function mainLabel(categories: Category[], id: string, fallback: string) {
  const c = categories.find((x) => x.id === id);
  return c ? displayName(c) : fallback;
}
