import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Ellipsis, Keyboard, Plus, Search, Loader2, ScanLine } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/toaster";
import { TransactionDialog } from "@/features/transactions/TransactionDialog";
import { isDesktop, isTauri, shortcutLabel } from "@/lib/platform";
import { usePrefs } from "@/stores/prefs";
import { Logo, ModeSwitch, TitleBar, toggleFullscreen, useApplyTitleBar } from "./TitleBar";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { GlobalContextMenu } from "./GlobalContextMenu";
import { Tip } from "@/components/ui/inputs";
import { cn } from "@/lib/cn";
import { useUi } from "@/stores/ui";
import { CommandPalette } from "./CommandPalette";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { ReceiptReviewDialog } from "@/features/receipts/ReceiptReviewDialog";
import { PairRequestDialog } from "@/features/devices/PairRequestDialog";
import { planning, sync } from "@/lib/api";
import i18n from "i18next";
import { useReceiptImport } from "@/features/receipts/receipt-ui";
import { navGroups, navItems, type NavItem } from "./nav";
import { useInsightNotifications } from "@/features/insights/insights";
import { useDailyReminder } from "@/features/today/reminder";
import { invalidateData, useInsights, useSyncStatus } from "@/lib/queries";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function useGlobalShortcuts(openHelp: () => void) {
  const setPalette = useUi((s) => s.setPaletteOpen);
  const openNew = useUi((s) => s.openNewTx);
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (mod && key === "k") {
        e.preventDefault();
        setPalette(!useUi.getState().paletteOpen);
        return;
      }
      if (mod && e.shiftKey && key === "h") {
        e.preventDefault();
        usePrefs.getState().toggle("privacy");
        return;
      }
      if (mod && !e.shiftKey && key === "b") {
        e.preventDefault();
        usePrefs.getState().toggle("sidebarCollapsed");
        return;
      }
      if (mod && key === ",") {
        e.preventDefault();
        navigate({ to: "/settings" });
        return;
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        const item = navItems[Number(e.key) - 1];
        if (item) {
          e.preventDefault();
          navigate({ to: item.to });
        }
        return;
      }
      const ui = useUi.getState();
      if (ui.paletteOpen || ui.txDialog.open || isTyping(e.target) || mod || e.altKey) return;
      if (key === "n") {
        e.preventDefault();
        openNew();
      } else if (e.key === "?") {
        e.preventDefault();
        openHelp();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalette, openNew, navigate, openHelp]);
}

function useStartPage() {
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const { startPage, simpleMode } = usePrefs.getState();
    const start = simpleMode ? "/today" : startPage;
    if (start !== "/" && window.location.pathname === "/") navigate({ to: start, replace: true });
  }, [navigate]);
}

function useLedgerEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const a = await listen("ledger-changed", () => invalidateData(qc));
        const b = await listen("sync-changed", () => qc.invalidateQueries({ queryKey: ["syncStatus"] }));
        const c = await listen("pair-request", () => qc.invalidateQueries({ queryKey: ["syncStatus"] }));
        let lastToast = 0;
        const d = await listen("sync-received", () => {
          if (Date.now() - lastToast < 8000) return;
          lastToast = Date.now();
          useUi.getState().toast(i18n.t("sync.receivedGeneric"));
        });
        const wake = () => {
          if (document.visibilityState !== "visible") return;
          sync.now().catch(() => {});
          planning
            .runScheduler()
            .then((n) => {
              if (n > 0) return invalidateData(qc);
            })
            .catch(() => {});
        };
        document.addEventListener("visibilitychange", wake);
        window.addEventListener("focus", wake);
        return () => {
          a();
          b();
          c();
          d();
          document.removeEventListener("visibilitychange", wake);
          window.removeEventListener("focus", wake);
        };
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [qc]);
}

function useGlobalDrop() {
  const importFiles = useReceiptImport();
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) importFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [importFiles]);
  return dragging;
}

type BadgeTone = "warn" | "critical" | "live";

function useNavBadges(): Record<string, { count: number; tone: BadgeTone }> {
  const insights = useInsights().data ?? [];
  const count = (kinds: string[]) => insights.filter((i) => kinds.includes(i.kind)).length;
  const badges: Record<string, { count: number; tone: BadgeTone }> = {};
  const add = (to: string, kinds: string[], tone: "warn" | "critical") => {
    const n = count(kinds);
    if (n) badges[to] = { count: n, tone };
  };
  add("/recurring", ["confirm_pending"], "warn");
  add("/debts", ["debt_overdue", "debt_due"], "critical");
  add("/budgets", ["budget_over"], "critical");
  add("/planner", ["low_balance", "balance_negative"], "critical");
  const live = (useSyncStatus().data?.peers ?? []).filter((p) => p.connected).length;
  if (live) badges["/devices"] = { count: live, tone: "live" };
  return badges;
}

const linkBase =
  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AppShell() {
  const { t } = useTranslation();
  const setPalette = useUi((s) => s.setPaletteOpen);
  const openNew = useUi((s) => s.openNewTx);
  const collapsed = usePrefs((s) => s.sidebarCollapsed);
  const simple = usePrefs((s) => s.simpleMode);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  useGlobalShortcuts(openHelp);
  useStartPage();
  useApplyTitleBar();
  useLedgerEvents();
  useInsightNotifications();
  useDailyReminder();
  const badges = useNavBadges();
  const dragging = useGlobalDrop();
  const processing = useUi((s) => s.processing);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border bg-surface/60 py-3 transition-[width] duration-300 ease-[var(--ease-out)]",
          !simple && "md:flex",
          collapsed ? "w-[3.75rem] px-2" : "w-60 px-3",
        )}
      >
        <nav className="flex flex-col gap-4 overflow-x-hidden overflow-y-auto">
          {navGroups.map((g) => (
            <div key={g} className="flex flex-col gap-0.5">
              {g !== "main" &&
                (collapsed ? (
                  <div className="mx-2 mb-1 h-px bg-border" />
                ) : (
                  <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted/80 uppercase">
                    {t(`nav.group.${g}`)}
                  </div>
                ))}
              {navItems
                .filter((n) => n.group === g)
                .map((n) => (
                  <SidebarLink
                    key={n.to}
                    item={n}
                    label={t(n.labelKey)}
                    badge={badges[n.to]}
                    collapsed={collapsed}
                    shortcut={navItems.indexOf(n) < 9 ? shortcutLabel(`Mod+${navItems.indexOf(n) + 1}`) : undefined}
                  />
                ))}
            </div>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1.5 pt-3">
          <Tip label={t("shortcuts.title")} side="right">
            <button
              type="button"
              onClick={openHelp}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg",
                collapsed && "justify-center px-0",
              )}
            >
              <Keyboard className="size-4 shrink-0" />
              {!collapsed && <span className="flex-1 text-left">{t("shortcuts.title")}</span>}
              {!collapsed && <span className="text-[11px] opacity-60">?</span>}
            </button>
          </Tip>
          <button
            type="button"
            onClick={() => openNew()}
            aria-label={t("tx.new")}
            className={cn(
              "flex items-center rounded-lg bg-accent py-2 text-[13px] font-medium text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.12)] transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              collapsed ? "justify-center px-0" : "justify-between px-3",
            )}
          >
            <span className="flex items-center gap-2">
              <Plus className="size-4" />
              {!collapsed && t("tx.new")}
            </span>
            {!collapsed && <span className="text-[11px] opacity-70">N</span>}
          </button>
        </div>
      </aside>

      <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
        <div className={cn("flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden", isTauri && isDesktop && "hidden")}>
          <Link to={simple ? "/today" : "/"} className="flex items-center gap-2">
            <Logo />
            <span className="text-[14px] font-semibold tracking-tight">{t("app.name")}</span>
          </Link>
          <ModeSwitch labels />
        </div>
        <div key={pathname} className={cn("animate-[page-in_220ms_var(--ease-out)] mx-auto max-w-6xl px-4 min-[1800px]:max-w-[88rem] pt-4 md:px-8 md:pt-7 md:pb-10", simple ? "pb-[max(2rem,env(safe-area-inset-bottom))]" : "pb-28")}>
          <Outlet />
        </div>
      </main>
      </div>

      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden",
          simple && "hidden",
        )}
      >
        {navItems
          .filter((n) => n.primary)
          .slice(0, 2)
          .map((n) => (
            <MobileLink key={n.to} to={n.to} label={t(n.labelKey)} icon={n.icon} />
          ))}
        <div className="flex items-center justify-center">
          <button
            type="button"
            aria-label={t("tx.new")}
            onClick={() => openNew()}
            className="flex size-12 -translate-y-3 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg active:scale-95"
          >
            <Plus className="size-6" />
          </button>
        </div>
        {navItems
          .filter((n) => n.primary)
          .slice(2, 3)
          .map((n) => (
            <MobileLink key={n.to} to={n.to} label={t(n.labelKey)} icon={n.icon} />
          ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted"
        >
          <Ellipsis className="size-5" />
          {t("nav.more")}
        </button>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen} title={t("nav.more")}>
        <nav className="grid grid-cols-3 gap-2">
          {navItems.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              onClick={() => setMoreOpen(false)}
              className="flex flex-col items-center gap-1.5 rounded-xl bg-surface-2 px-2 py-3 text-center text-[12px] font-medium"
            >
              <n.icon className="size-5 text-accent" />
              {t(n.labelKey)}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => {
            setMoreOpen(false);
            setPalette(true);
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-[13px] text-muted"
        >
          <Search className="size-4" />
          {t("common.search")}
        </button>
      </Dialog>

      <Onboarding />
      <TransactionDialog />
      <ReceiptReviewDialog />
      <PairRequestDialog />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-accent/10 p-6 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-surface/95 px-10 py-8 text-center shadow-2xl">
            <ScanLine className="size-8 text-accent" />
            <div className="text-[15px] font-semibold">{t("receipts.dropTitle")}</div>
            <div className="text-[13px] text-muted">{t("receipts.dropHint")}</div>
          </div>
        </div>
      )}
      {processing > 0 && (
        <div className="fixed right-4 bottom-20 z-[60] flex items-center gap-2 rounded-full bg-fg px-3.5 py-2 text-[13px] font-medium text-bg shadow-lg md:bottom-6">
          <Loader2 className="size-4 animate-spin" />
          {t("receipts.processing", { count: processing })}
        </div>
      )}
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <CommandPalette />
      <GlobalContextMenu />
      <Toaster />
    </div>
  );
}

function SidebarLink({
  item: n,
  label,
  badge,
  collapsed,
  shortcut,
}: {
  item: NavItem;
  label: string;
  badge?: { count: number; tone: BadgeTone };
  collapsed: boolean;
  shortcut?: string;
}) {
  const tone =
    badge?.tone === "critical" ? "bg-expense text-white" : badge?.tone === "live" ? "bg-income/15 text-income" : "bg-warn/20 text-warn";
  const link = (
    <Link
      to={n.to}
      activeOptions={{ exact: n.to === "/" }}
      className={cn(
        linkBase,
        "group relative text-muted hover:bg-surface-2 hover:text-fg",
        collapsed && "justify-center px-0 py-2",
      )}
      activeProps={{ className: "!bg-accent-soft !text-fg [&_svg]:!text-accent" }}
    >
      <n.icon className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {badge &&
        (collapsed ? (
          <span
            className={cn(
              "absolute top-1 right-1.5 size-2 rounded-full ring-2 ring-surface",
              badge.tone === "critical" ? "bg-expense" : badge.tone === "live" ? "bg-income" : "bg-warn",
            )}
          />
        ) : (
          <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold", tone)}>{badge.count}</span>
        ))}
    </Link>
  );
  return collapsed ? (
    <Tip label={shortcut ? `${label} · ${shortcut}` : label} side="right">
      {link}
    </Tip>
  ) : (
    link
  );
}

function MobileLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: (typeof navItems)[number]["icon"];
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted"
      activeProps={{ className: "!text-accent" }}
    >
      <Icon className="size-5" />
      <span className="max-w-full truncate px-1">{label}</span>
    </Link>
  );
}
