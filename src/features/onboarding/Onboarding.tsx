import logo from "@/assets/logo.png";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog as D } from "radix-ui";
import { ArrowLeft, ArrowRight, Briefcase, Check, House, Landmark, Sparkles, Wallet } from "lucide-react";
import { ACCENTS, type Accent, usePrefs } from "@/stores/prefs";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { MoneyInput, parseSignedMoney } from "@/components/ui/extra";
import { Stepper } from "@/components/ui/inputs";
import { Segmented } from "@/components/ui/segmented";
import { api, demo, planning } from "@/lib/api";
import { cn } from "@/lib/cn";
import { languages } from "@/lib/i18n";
import { parseMoney } from "@/lib/money";
import { invalidateData, useAccounts, useAppInfo, useErrorMessage, useSettings, useTransactions } from "@/lib/queries";
import { useUi, type Theme } from "@/stores/ui";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "PLN", "CZK", "SEK", "NOK", "DKK", "TRY", "JPY"];

function nextDay(day: number): string {
  const now = new Date();
  const make = (y: number, m: number) => {
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day, last));
  };
  let d = make(now.getFullYear(), now.getMonth());
  if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d = make(now.getFullYear(), now.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function Onboarding() {
  const settings = useSettings();
  const txs = useTransactions({ limit: 1 });
  const show =
    settings.isSuccess && txs.isSuccess && settings.data.onboarded !== "1" && (txs.data?.length ?? 0) === 0;
  if (!show) return null;
  return <Wizard />;
}

function Wizard() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const errorMessage = useErrorMessage();
  const info = useAppInfo().data;
  const accounts = useAccounts().data ?? [];
  const accent = usePrefs((s) => s.accent);
  const setAccent = usePrefs((s) => s.set);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState(info?.defaultCurrency ?? "EUR");
  const [giro, setGiro] = useState("");
  const [cash, setCash] = useState("");
  const [salary, setSalary] = useState("");
  const [salaryDay, setSalaryDay] = useState(27);
  const [rent, setRent] = useState("");
  const [rentDay, setRentDay] = useState(1);

  async function finish(withDemo: boolean) {
    setBusy(true);
    try {
      await api.setDefaultCurrency(currency);
      const cashAccount = accounts.find((a) => a.kind === "cash") ?? accounts[0];
      if (cashAccount && cash.trim()) {
        await api.upsertAccount({
          id: cashAccount.id,
          name: cashAccount.systemKey ? t("account.cash") : cashAccount.name,
          kind: cashAccount.kind,
          currency,
          openingMinor: 0,
          color: cashAccount.color,
        });
        await api.setAccountBalance(cashAccount.id, parseSignedMoney(cash, currency) ?? 0);
      }
      let main = cashAccount?.id;
      if (giro.trim()) {
        const a = await api.upsertAccount({
          name: t("account.kinds.checking"),
          kind: "checking",
          currency,
          openingMinor: 0,
          color: "#2563eb",
        });
        await api.setAccountBalance(a.id, parseSignedMoney(giro, currency) ?? 0);
        main = a.id;
      }
      const categories = await api.listCategories();
      const byKey = (k: string) => categories.find((c) => c.systemKey === `category.${k}`)?.id ?? null;
      const salaryMinor = parseMoney(salary, currency);
      if (main && salaryMinor) {
        await planning.upsertRecurring({
          title: t("category.salary"),
          kind: "income",
          amountMinor: salaryMinor,
          accountId: main,
          categoryId: byKey("salary"),
          freq: "monthly",
          intervalN: 1,
          startOn: nextDay(salaryDay),
          autoPost: true,
        });
      }
      const rentMinor = parseMoney(rent, currency);
      if (main && rentMinor) {
        await planning.upsertRecurring({
          title: t("onboarding.rent"),
          kind: "expense",
          amountMinor: rentMinor,
          accountId: main,
          categoryId: byKey("housing"),
          freq: "monthly",
          intervalN: 1,
          startOn: nextDay(rentDay),
          autoPost: true,
        });
      }
      if (withDemo) await demo.load(i18n.language);
      await planning.setSetting("onboarded", "1");
      await invalidateData(qc);
      toast(withDemo ? t("onboarding.demoLoaded") : t("onboarding.ready"));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    await planning.setSetting("onboarded", "1").catch(() => {});
    await invalidateData(qc);
  }

  const steps = [
    {
      icon: Sparkles,
      title: t("onboarding.welcome"),
      text: t("onboarding.welcomeText"),
      body: (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.language")} htmlFor="ob-lang">
              <Select id="ob-lang" value={i18n.language} onValueChange={(v) => i18n.changeLanguage(v)} items={languages.map((l) => ({ value: l.code, label: l.label }))} />
            </Field>
            <Field label={t("settings.currency")} htmlFor="ob-cur">
              <Select id="ob-cur" value={currency} onValueChange={setCurrency} items={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
          <Field label={t("settings.theme")}>
            <Segmented<Theme>
              aria-label={t("settings.theme")}
              value={theme}
              onChange={setTheme}
              className="w-full"
              options={(["system", "light", "dark", "midnight"] as const).map((v) => ({ value: v, label: t(`settings.themes.${v}`) }))}
            />
          </Field>
          <Field label={t("appearance.accent")}>
            <div role="radiogroup" className="flex flex-wrap gap-2">
              {(Object.keys(ACCENTS) as Accent[]).map((a) => {
                const color = ACCENTS[a][document.documentElement.classList.contains("dark") ? "dark" : "light"];
                const active = accent === a;
                return (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={t(`appearance.accents.${a}`)}
                    onClick={() => setAccent("accent", a)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full transition-transform duration-150 ease-[var(--ease-out)] hover:scale-110 active:scale-95",
                      active && "ring-2 ring-offset-2 ring-offset-surface",
                    )}
                    style={{ background: color, ["--tw-ring-color" as string]: color }}
                  >
                    {active && <Check className="size-3.5 text-accent-fg" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      ),
    },
    {
      icon: Wallet,
      title: t("onboarding.accounts"),
      text: t("onboarding.accountsText"),
      body: (
        <div className="flex flex-col gap-3">
          <Row icon={Landmark} label={t("account.kinds.checking")}>
            <MoneyInput value={giro} onChange={setGiro} currency={currency} allowNegative placeholder="0,00" />
          </Row>
          <Row icon={Wallet} label={t("account.cash")}>
            <MoneyInput value={cash} onChange={setCash} currency={currency} allowNegative placeholder="0,00" />
          </Row>
        </div>
      ),
    },
    {
      icon: Briefcase,
      title: t("onboarding.flows"),
      text: t("onboarding.flowsText"),
      body: (
        <div className="flex flex-col gap-3">
          <Row icon={Briefcase} label={t("category.salary")}>
            <div className="flex gap-2">
              <MoneyInput value={salary} onChange={setSalary} currency={currency} placeholder="0,00" />
              <Stepper aria-label={t("onboarding.dayOfMonth")} prefix={t("onboarding.on")} suffix="." value={salaryDay} min={1} max={31} onChange={setSalaryDay} className="w-36 shrink-0" />
            </div>
          </Row>
          <Row icon={House} label={t("onboarding.rent")}>
            <div className="flex gap-2">
              <MoneyInput value={rent} onChange={setRent} currency={currency} placeholder="0,00" />
              <Stepper aria-label={t("onboarding.dayOfMonth")} prefix={t("onboarding.on")} suffix="." value={rentDay} min={1} max={31} onChange={setRentDay} className="w-36 shrink-0" />
            </div>
          </Row>
        </div>
      ),
    },
  ];
  const last = step === steps.length - 1;
  const S = steps[step];

  return (
    <D.Root open>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[100] bg-bg/80 backdrop-blur-md" />
        <D.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus({ preventScroll: true });
          }}
          className="fixed inset-x-3 top-[max(1.5rem,11vh)] z-[100] mx-auto h-fit outline-none max-h-[calc(100dvh-1.5rem)] max-w-md overflow-y-auto rounded-3xl border border-border bg-surface shadow-[0_32px_80px_-20px_rgb(0_0_0/0.35)] animate-[dialog-in_260ms_var(--ease-out)]"
        >
          <div className="relative overflow-hidden bg-[linear-gradient(140deg,color-mix(in_srgb,var(--accent)_82%,#000)_0%,color-mix(in_srgb,var(--accent)_45%,#000)_100%)] px-6 pt-7 pb-6 text-white">
            <div className="absolute -top-20 -right-12 size-56 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.22),transparent_65%)]" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-white/15" />
            {step === 0 ? (
              <img src={logo} alt="" className="relative size-12 drop-shadow-[0_8px_16px_rgb(0_0_0/0.25)]" />
            ) : (
              <span className="relative flex size-11 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20 backdrop-blur">
                <S.icon className="size-5" />
              </span>
            )}
            <D.Title className="relative mt-3 text-xl font-semibold tracking-tight">{S.title}</D.Title>
            <D.Description className="relative mt-1 text-[13px] text-white/75">{S.text}</D.Description>
          </div>
          <div key={step} className="px-6 py-5 animate-[step-in_280ms_var(--ease-out)]">{S.body}</div>
          <div className="flex items-center gap-2 border-t border-border px-6 py-4">
            <div className="flex gap-1.5" aria-hidden>
              {steps.map((_, i) => (
                <span key={i} className={cn("h-1.5 rounded-full transition-[width,background-color] duration-300", i === step ? "w-5 bg-accent" : "w-1.5 bg-border")} />
              ))}
            </div>
            <div className="ml-auto flex gap-2">
              {step > 0 ? (
                <Button variant="ghost" onClick={() => setStep(step - 1)} aria-label={t("date.prev")}>
                  <ArrowLeft className="size-4" />
                </Button>
              ) : (
                <Button variant="ghost" onClick={skip}>
                  {t("onboarding.skip")}
                </Button>
              )}
              {last ? (
                <Button variant="primary" disabled={busy} onClick={() => finish(false)}>
                  {t("onboarding.start")}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setStep(step + 1)}>
                  {t("onboarding.next")}
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </div>
          {step === 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => finish(true)}
              className="w-full border-t border-border bg-surface-2/60 px-6 py-3 text-[13px] font-medium text-accent hover:bg-surface-2 active:scale-100"
            >
              <Sparkles className="mr-1.5 inline size-3.5" />
              {t("onboarding.tryDemo")}
            </button>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Wallet; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[2rem_1fr] items-center gap-x-3 gap-y-1.5">
      <span className="flex size-8 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
        <Icon className="size-4" />
      </span>
      <span className="text-[13px] font-medium">{label}</span>
      <span />
      {children}
    </div>
  );
}
