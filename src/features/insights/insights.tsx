import { useEffect } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BellRing,
  CalendarCheck,
  ChevronRight,
  CircleAlert,
  PartyPopper,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { planning, type Insight } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDay } from "@/lib/dates";
import { percent, relativeDays } from "@/lib/format";
import { activeLocale, displayName } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { useCategories, useSettings } from "@/lib/queries";

const ICON: Record<Insight["kind"], LucideIcon> = {
  confirm_pending: BellRing,
  income_soon: CalendarCheck,
  income_next: CalendarCheck,
  payment_today: AlertTriangle,
  payment_soon: CalendarCheck,
  low_balance: TrendingDown,
  balance_negative: TrendingDown,
  debt_due: CircleAlert,
  debt_overdue: CircleAlert,
  budget_over: Wallet,
  budget_warn: Wallet,
  budget_trend: Wallet,
  goal_reached: PartyPopper,
  goal_behind: TrendingDown,
};

const TARGET: Record<Insight["kind"], string> = {
  confirm_pending: "/recurring",
  income_soon: "/planner",
  income_next: "/planner",
  payment_today: "/recurring",
  payment_soon: "/planner",
  low_balance: "/planner",
  balance_negative: "/accounts",
  debt_due: "/debts",
  debt_overdue: "/debts",
  budget_over: "/budgets",
  budget_warn: "/budgets",
  budget_trend: "/budgets",
  goal_reached: "/goals",
  goal_behind: "/goals",
};

const SEVERITY_STYLE: Record<Insight["severity"], string> = {
  critical: "text-expense bg-expense/10",
  warning: "text-warn bg-warn/12",
  info: "text-accent bg-accent-soft",
  success: "text-income bg-income/10",
};

export function insightText(t: TFunction, i: Insight, categoryName?: string): string {
  const amount =
    i.amountMinor !== null && i.currency ? formatMoney(Math.abs(i.amountMinor), i.currency, activeLocale()) : "";
  return t(`insights.${i.kind}`, {
    title: i.title ?? "",
    amount,
    when: i.days !== null ? relativeDays(i.days) : "",
    date: i.date ? formatDay(i.date) : "",
    days: Math.abs(i.days ?? 0),
    category: categoryName ?? "",
    percent: i.ratio !== null ? percent(i.ratio) : "",
  });
}

function useCategoryName() {
  const categories = useCategories().data ?? [];
  return (id: string | null) => {
    const c = categories.find((c) => c.id === id);
    return c ? displayName(c) : undefined;
  };
}

export function InsightList({ items, limit }: { items: Insight[]; limit?: number }) {
  const { t } = useTranslation();
  const categoryName = useCategoryName();
  return (
    <ul className="flex flex-col">
      {items.slice(0, limit).map((i) => {
        const Icon = ICON[i.kind];
        return (
          <li key={i.id}>
            <Link
              to={TARGET[i.kind]}
              className="group flex items-center gap-3 rounded-lg px-4 py-2 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", SEVERITY_STYLE[i.severity])}>
                <Icon className="size-3.5" />
                <span className="sr-only">{t(`insights.severity.${i.severity}`)}</span>
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug">
                {insightText(t, i, categoryName(i.refId))}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const SENT_KEY = "zc.notified";

function readSent(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function useInsightNotifications() {
  const { t } = useTranslation();
  const settings = useSettings().data;
  const categoryName = useCategoryName();
  const enabled = settings?.notifications !== "0";

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function check() {
      try {
        const { isPermissionGranted, requestPermission, sendNotification } = await import(
          "@tauri-apps/plugin-notification"
        );
        const insights = await planning.insights();
        const due = insights.filter(
          (i) =>
            i.severity === "critical" ||
            i.kind === "confirm_pending" ||
            i.kind === "payment_today" ||
            i.kind === "budget_over" ||
            (i.kind === "income_soon" && i.days === 0),
        );
        const sent = readSent();
        const fresh = due.filter((i) => !sent.has(i.id));
        if (!fresh.length || cancelled) return;
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (!granted) return;
        for (const i of fresh.slice(0, 3)) {
          sendNotification({ title: t("app.name"), body: insightText(t, i, categoryName(i.refId)) });
          sent.add(i.id);
        }
        try {
          localStorage.setItem(SENT_KEY, JSON.stringify([...sent].slice(-300)));
        } catch {
        }
      } catch {
      }
    }

    const first = setTimeout(check, 4000);
    const timer = setInterval(check, 30 * 60_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled]);
}
