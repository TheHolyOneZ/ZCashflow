import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { FilePenLine, Moon, Plus, ScanLine, Search, Zap } from "lucide-react";
import { api, type QuickEntry } from "@/lib/api";
import { entryTime, formatDay } from "@/lib/dates";
import { activeLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { useAccounts, useAppInfo, useSaveTransaction } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { navItems } from "./nav";

const item =
  "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] select-none " +
  "data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg";
const group =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 " +
  "[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted";

export function CommandPalette() {
  const { t } = useTranslation();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const openNew = useUi((s) => s.openNewTx);
  const toast = useUi((s) => s.toast);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const navigate = useNavigate();
  const accounts = useAccounts().data ?? [];
  const defaultCurrency = useAppInfo().data?.defaultCurrency ?? "EUR";
  const save = useSaveTransaction();

  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<QuickEntry | null>(null);

  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  useEffect(() => {
    if (!text.trim()) {
      setParsed(null);
      return;
    }
    let stale = false;
    api.parseQuickEntry(text).then((p) => !stale && setParsed(p), () => !stale && setParsed(null));
    return () => {
      stale = true;
    };
  }, [text]);

  const account =
    accounts.find((a) => !a.archived && a.currency === defaultCurrency) ??
    accounts.find((a) => !a.archived);

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  async function quickAdd() {
    if (!parsed?.amountMinor || !account) return;
    setOpen(false);
    try {
      await save.mutateAsync({
        input: {
          kind: parsed.kind,
          amountMinor: parsed.amountMinor,
          occurredOn: parsed.occurredOn,
          occurredTime: entryTime(parsed.occurredOn),
          accountId: account.id,
          title: parsed.title,
        },
      });
      toast(t("tx.saved"));
    } catch {
    }
  }

  const draft = parsed
    ? {
        kind: parsed.kind,
        amountMinor: parsed.amountMinor ?? undefined,
        occurredOn: parsed.occurredOn,
        title: parsed.title,
      }
    : {};
  const locale = activeLocale();
  const currency = account?.currency ?? defaultCurrency;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label={t("palette.placeholder")}
      shouldFilter={true}
      overlayClassName="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
      contentClassName="fixed inset-x-3 top-[10vh] z-50 mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Zap className="size-4 text-accent" />
        <Command.Input
          value={text}
          onValueChange={setText}
          placeholder={t("palette.placeholder")}
          className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
        />
      </div>
      <Command.List className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
        {parsed && (
          <Command.Group heading={t("palette.actions")} className={group} forceMount>
            {parsed.amountMinor && account ? (
              <Command.Item value={`quick ${text}`} onSelect={quickAdd} className={item} forceMount>
                <Plus className="size-4 text-accent" />
                <span className="flex-1 truncate">
                  {t("palette.quickAdd")}: <strong>{parsed.title || t("tx.untitled")}</strong>
                </span>
                <span className="text-[12px] text-muted tabular">
                  {t("palette.quickAddHint", {
                    kind: t(`kind.${parsed.kind}`),
                    amount: formatMoney(parsed.amountMinor, currency, locale),
                    date: formatDay(parsed.occurredOn),
                  })}
                </span>
              </Command.Item>
            ) : null}
            <Command.Item value={`form ${text}`} onSelect={() => openNew(draft)} className={item} forceMount>
              <FilePenLine className="size-4 text-muted" />
              {t("palette.openForm")}
              {!parsed.amountMinor && (
                <span className="ml-auto text-[12px] text-muted">{t("palette.noAmount")}</span>
              )}
            </Command.Item>
            <Command.Item
              value={`search ${text}`}
              onSelect={() => run(() => navigate({ to: "/transactions", search: { q: text.trim() } }))}
              className={item}
              forceMount
            >
              <Search className="size-4 text-muted" />
              <span className="truncate">{t("palette.searchFor", { q: text.trim() })}</span>
            </Command.Item>
          </Command.Group>
        )}

        <Command.Group heading={t("palette.navigate")} className={group}>
          {navItems.map((n) => (
            <Command.Item
              key={n.to}
              value={t(n.labelKey)}
              onSelect={() => run(() => navigate({ to: n.to }))}
              className={item}
            >
              <n.icon className="size-4 text-muted" />
              {t(n.labelKey)}
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading={t("palette.actions")} className={group}>
          <Command.Item value={t("tx.new")} onSelect={() => openNew()} className={item}>
            <Plus className="size-4 text-muted" />
            {t("tx.new")}
            <span className="ml-auto text-[11px] text-muted">N</span>
          </Command.Item>
          <Command.Item value={t("receipts.scanTitle")} onSelect={() => run(() => navigate({ to: "/receipts" }))} className={item}>
            <ScanLine className="size-4 text-muted" />
            {t("receipts.scanTitle")}
          </Command.Item>
          <Command.Item
            value={t("palette.toggleTheme")}
            onSelect={() =>
              run(() =>
                setTheme(
                  theme === "dark" ||
                    (theme === "system" && document.documentElement.classList.contains("dark"))
                    ? "light"
                    : "dark",
                ),
              )
            }
            className={item}
          >
            <Moon className="size-4 text-muted" />
            {t("palette.toggleTheme")}
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
