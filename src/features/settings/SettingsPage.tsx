import { useEffect, useRef, useState, type ReactNode } from "react";
import { REMINDER_TIMES } from "@/features/today/reminder";
import { About } from "./About";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Coins,
  Database,
  Download,
  HardDriveDownload,
  Info,
  LayoutDashboard,
  Palette,
  RotateCcw,
  ScanLine,
  SlidersHorizontal,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Card, PageHeader } from "@/components/ui/misc";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/extra";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { minorDigits } from "@/lib/money";
import { usePrefs, type CurrencySymbol, type ExpenseStyle, type TxPeriod } from "@/stores/prefs";
import { cn } from "@/lib/cn";
import { OcrSettings } from "./OcrSettings";
import { DemoControls } from "./DemoControls";
import { AppearanceSettings } from "./AppearanceSettings";
import { DashboardSettings } from "./DashboardSettings";
import { ResetData } from "./ResetData";
import { ExportDialog } from "@/features/data/ExportDialog";
import { ImportDialog } from "@/features/data/ImportDialog";
import { pickSavePath } from "@/features/data/export";
import { api, planning } from "@/lib/api";
import { isoDate } from "@/lib/dates";
import { activeLocale, languages } from "@/lib/i18n";
import { currencyItems } from "@/lib/currencies";
import { invalidateData, useAccounts, useAppInfo, useErrorMessage, useSettings } from "@/lib/queries";
import { useUi } from "@/stores/ui";

const SECTIONS: { id: string; icon: LucideIcon; key: string }[] = [
  { id: "general", icon: SlidersHorizontal, key: "settings.general" },
  { id: "appearance", icon: Palette, key: "appearance.title" },
  { id: "amounts", icon: Coins, key: "amounts.title" },
  { id: "dashboard", icon: LayoutDashboard, key: "dashboardSettings.title" },
  { id: "reminders", icon: Bell, key: "settings.reminders" },
  { id: "receipts", icon: ScanLine, key: "ocr.title" },
  { id: "data", icon: Database, key: "settings.data" },
  { id: "reset", icon: RotateCcw, key: "reset.title" },
  { id: "about", icon: Info, key: "settings.about" },
];

function Section({ id, icon: Icon, title, hint, children }: { id: string; icon: LucideIcon; title: string; hint?: string; children: ReactNode }) {
  return (
    <Card id={`settings-${id}`} className="scroll-mt-6">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

function Field2({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-2 border-t border-border py-3.5 first:border-0 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr] sm:gap-6">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="max-w-xs">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const info = useAppInfo().data;
  const qc = useQueryClient();
  const accounts = useAccounts().data ?? [];
  const [switchTo, setSwitchTo] = useState<{ from: string; to: string } | null>(null);
  const currencySymbol = usePrefs((s) => s.currencySymbol);
  const expenseStyle = usePrefs((s) => s.expenseStyle);
  const txPeriod = usePrefs((s) => s.txPeriod);
  const setPref = usePrefs((s) => s.set);
  const settings = useSettings().data ?? {};
  const [active, setActive] = useState("general");
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lockUntil = useRef(0);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(`settings-${s.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        if (Date.now() < lockUntil.current) return;
        const scroller = rootRef.current?.closest("main");
        if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
          setActive(SECTIONS[SECTIONS.length - 1].id);
          return;
        }
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.replace("settings-", ""));
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  async function setSetting(key: "remind_days" | "notifications" | "daily_reminder", value: string) {
    try {
      await planning.setSetting(key, value);
      await qc.invalidateQueries();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function saveBackup() {
    try {
      const path = await pickSavePath(`zcashflow-backup-${isoDate()}.db`, { name: "SQLite", extensions: ["db"] });
      if (!path) return;
      await planning.backupDatabase(path);
      toast(t("settings.backedUp"));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function changeCurrency(currency: string) {
    const used = [...new Set(accounts.map((a) => a.currency))];
    const from = used.length === 1 ? used[0] : null;
    if (from && from !== currency && minorDigits(from) === minorDigits(currency)) {
      setSwitchTo({ from, to: currency });
      return;
    }
    await keepAccounts(currency);
  }

  async function keepAccounts(currency: string) {
    setSwitchTo(null);
    try {
      await api.setDefaultCurrency(currency);
      await invalidateData(qc);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function switchAccounts(from: string, to: string) {
    setSwitchTo(null);
    try {
      await api.relabelCurrency(from, to);
      await invalidateData(qc);
      toast(t("currencySwitch.done", { currency: to }));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <PageHeader title={t("nav.settings")} subtitle={t("settings.subtitle")} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[11.5rem_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ul className="sticky top-2 flex flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    lockUntil.current = Date.now() + 900;
                    setActive(s.id);
                    document.getElementById(`settings-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors active:scale-100",
                    active === s.id ? "bg-surface text-fg shadow-sm [&_svg]:text-accent" : "text-muted hover:text-fg",
                  )}
                >
                  <s.icon className="size-4" />
                  {t(s.key)}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <Section id="general" icon={SlidersHorizontal} title={t("settings.general")}>
            <Field2 label={t("settings.language")}>
              <Select
                aria-label={t("settings.language")}
                value={i18n.language}
                onValueChange={(v) => i18n.changeLanguage(v)}
                items={languages.map((l) => ({ value: l.code, label: l.label }))}
              />
            </Field2>
            <Field2 label={t("settings.currency")}>
              <Select
                aria-label={t("settings.currency")}
                value={info?.defaultCurrency ?? ""}
                onValueChange={changeCurrency}
                items={currencyItems(activeLocale(), info?.defaultCurrency)}
              />
            </Field2>
          </Section>

          <Section id="appearance" icon={Palette} title={t("appearance.title")} hint={t("appearance.hint")}>
            <AppearanceSettings />
          </Section>

          <Section id="amounts" icon={Coins} title={t("amounts.title")} hint={t("amounts.hint")}>
            <Field2 label={t("amounts.currencySymbol")} hint={t("amounts.currencySymbolHint")}>
              <Segmented<CurrencySymbol>
                aria-label={t("amounts.currencySymbol")}
                value={currencySymbol}
                onChange={(v) => setPref("currencySymbol", v)}
                className="w-full"
                options={[
                  { value: "show", label: t("amounts.symbolShow") },
                  { value: "single", label: t("amounts.symbolSingle") },
                ]}
              />
            </Field2>
            <Field2 label={t("amounts.expenses")} hint={t("amounts.expensesHint")}>
              <Segmented<ExpenseStyle>
                aria-label={t("amounts.expenses")}
                value={expenseStyle}
                onChange={(v) => setPref("expenseStyle", v)}
                className="w-full"
                options={[
                  { value: "minus", label: t("amounts.expenseMinus") },
                  { value: "red", label: t("amounts.expenseRed"), className: "text-expense" },
                ]}
              />
            </Field2>
            <Field2 label={t("amounts.txPeriod")} hint={t("amounts.txPeriodHint")}>
              <Segmented<TxPeriod>
                aria-label={t("amounts.txPeriod")}
                value={txPeriod}
                onChange={(v) => setPref("txPeriod", v)}
                className="w-full"
                options={[
                  { value: "all", label: t("amounts.periodAll") },
                  { value: "month", label: t("amounts.periodMonth") },
                ]}
              />
            </Field2>
          </Section>

          <Section id="dashboard" icon={LayoutDashboard} title={t("dashboardSettings.title")}>
            <DashboardSettings />
          </Section>

          <Section id="reminders" icon={Bell} title={t("settings.reminders")}>
            <div className="flex flex-col">
              <div className="pb-3.5">
                <SwitchRow
                  label={t("settings.notifications")}
                  hint={t("settings.notificationsHint")}
                  checked={settings.notifications !== "0"}
                  onCheckedChange={(v) => setSetting("notifications", v ? "1" : "0")}
                />
              </div>
              <Field2 label={t("today.reminder")} hint={t("today.reminderHint")}>
                <Select
                  aria-label={t("today.reminder")}
                  value={settings.daily_reminder || "off"}
                  onValueChange={(v) => setSetting("daily_reminder", v === "off" ? "" : v)}
                  items={[{ value: "off", label: t("today.reminderOff") }, ...REMINDER_TIMES.map((v) => ({ value: v, label: v }))]}
                />
              </Field2>
              <Field2 label={t("settings.remindDays")}>
                <Select
                  aria-label={t("settings.remindDays")}
                  value={settings.remind_days ?? "3"}
                  onValueChange={(v) => setSetting("remind_days", v)}
                  items={["1", "2", "3", "5", "7", "14"].map((d) => ({ value: d, label: t("settings.daysBefore", { count: Number(d) }) }))}
                />
              </Field2>
            </div>
          </Section>

          <Section id="receipts" icon={ScanLine} title={t("ocr.title")}>
            <OcrSettings />
          </Section>

          <Section id="data" icon={Database} title={t("settings.data")} hint={t("settings.dataHint")}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setExportOpen(true)}>
                  <Download className="size-4" />
                  {t("settings.exportCsv")}
                </Button>
                <Button onClick={() => setImportOpen(true)}>
                  <Upload className="size-4" />
                  {t("settings.importCsv")}
                </Button>
                <Button onClick={saveBackup}>
                  <HardDriveDownload className="size-4" />
                  {t("settings.backup")}
                </Button>
              </div>
              <DemoControls />
            </div>
            <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
            <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
          </Section>

          <Section id="reset" icon={RotateCcw} title={t("reset.title")} hint={t("reset.hint")}>
            <ResetData />
          </Section>

          <Section id="about" icon={Info} title={t("settings.about")}>
            <About />
          </Section>
        </div>
      </div>
      <Dialog
        open={!!switchTo}
        onOpenChange={(o) => !o && setSwitchTo(null)}
        title={t("currencySwitch.title", { currency: switchTo?.to ?? "" })}
      >
        {switchTo && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-muted">{t("currencySwitch.text", switchTo)}</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={() => keepAccounts(switchTo.to)}>{t("currencySwitch.onlyDefault")}</Button>
              <Button variant="primary" onClick={() => switchAccounts(switchTo.from, switchTo.to)}>
                {t("currencySwitch.switchAll", { currency: switchTo.to })}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
