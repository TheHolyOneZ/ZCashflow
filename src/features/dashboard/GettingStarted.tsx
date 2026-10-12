import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, Check, PiggyBank, Plus, ScanLine, Sparkles, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { demo } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAppMutation, useBudgets, useGoals, useRecurring, useTransactions } from "@/lib/queries";
import { useUi } from "@/stores/ui";

export function GettingStarted() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const openNew = useUi((s) => s.openNewTx);
  const txs = useTransactions({ limit: 1 }).data ?? [];
  const rules = useRecurring().data ?? [];
  const budgets = useBudgets().data ?? [];
  const goals = useGoals().data ?? [];
  const loadDemo = useAppMutation(() => demo.load(i18n.language), { success: t("onboarding.demoLoaded") });

  const steps: { icon: LucideIcon; title: string; hint: string; done: boolean; run: () => void }[] = [
    { icon: Plus, title: t("start.firstTx"), hint: t("start.firstTxHint"), done: txs.length > 0, run: () => openNew() },
    { icon: CalendarClock, title: t("start.recurring"), hint: t("start.recurringHint"), done: rules.length > 0, run: () => navigate({ to: "/recurring" }) },
    { icon: ScanLine, title: t("start.receipt"), hint: t("start.receiptHint"), done: false, run: () => navigate({ to: "/receipts" }) },
    { icon: PiggyBank, title: t("start.plan"), hint: t("start.planHint"), done: budgets.length + goals.length > 0, run: () => navigate({ to: "/goals" }) },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <Card className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-24 size-96 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--accent)_14%,transparent),transparent_70%)]" />
      <div className="relative flex flex-wrap items-end justify-between gap-4 px-6 pt-6">
        <div>
          <div className="text-[12px] font-semibold tracking-wide text-accent uppercase">{t("start.kicker")}</div>
          <h2 className="mt-1 text-[22px] font-semibold tracking-tight">{t("start.title")}</h2>
          <p className="mt-1 max-w-lg text-[13px] text-muted">{t("start.text")}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted tabular-nums">{t("start.progress", { done, total: steps.length })}</span>
          <div className="flex gap-1">
            {steps.map((s, i) => (
              <span key={i} className={cn("h-1.5 w-6 rounded-full", s.done ? "bg-accent" : "bg-border")} />
            ))}
          </div>
        </div>
      </div>
      <ul className="relative grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={s.run}
              className={cn(
                "group flex h-full w-full flex-col gap-3 rounded-xl border p-4 text-left transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-0.5 active:scale-[0.98]",
                s.done ? "border-accent/30 bg-accent-soft/60" : "border-border bg-surface hover:border-accent/50",
              )}
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg",
                  s.done ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted group-hover:text-accent",
                )}
              >
                {s.done ? <Check className="size-4" strokeWidth={3} /> : <s.icon className="size-4" />}
              </span>
              <span>
                <span className={cn("block text-[14px] font-semibold", s.done && "text-muted line-through decoration-1")}>{s.title}</span>
                <span className="mt-0.5 block text-[12px] text-muted">{s.hint}</span>
              </span>
              {!s.done && (
                <span className="mt-auto flex items-center gap-1 text-[12px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                  {t("start.go")}
                  <ArrowRight className="size-3.5" />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {txs.length === 0 && (
        <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2/40 px-6 py-3.5">
          <span className="text-[13px] text-muted">{t("start.demoHint")}</span>
          <button
            type="button"
            disabled={loadDemo.isPending}
            onClick={() => loadDemo.mutate(undefined)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft"
          >
            <Sparkles className="size-3.5" />
            {t("onboarding.tryDemo")}
          </button>
        </div>
      )}
    </Card>
  );
}
