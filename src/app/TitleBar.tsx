import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarCheck2, Eye, EyeOff, LayoutGrid, Minus, Moon, PanelLeft, Search, Square, Sun, X } from "lucide-react";
import { Tip } from "@/components/ui/inputs";
import { Kbd } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import logo from "@/assets/logo.png";
import { isTauri, os, shortcutLabel } from "@/lib/platform";
import { useSyncStatus } from "@/lib/queries";
import { usePrefs } from "@/stores/prefs";
import { useUi } from "@/stores/ui";

type Win = Awaited<typeof import("@tauri-apps/api/window")>;

function useWindow() {
  const [api, setApi] = useState<Win | null>(null);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/window").then(async (m) => {
      setApi(m);
      const w = m.getCurrentWindow();
      setMaximized(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    }, () => {});
    return () => unlisten?.();
  }, []);
  return { win: api?.getCurrentWindow() ?? null, maximized };
}

export function useApplyTitleBar() {
  const titleBar = usePrefs((s) => s.titleBar);
  useEffect(() => {
    if (!isTauri || os === "mac" || os === "mobile") return;
    import("@tauri-apps/api/window")
      .then((m) => m.getCurrentWindow().setDecorations(titleBar === "system"))
      .catch(() => {});
  }, [titleBar]);
}

function ToolButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <Tip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

export function TitleBar() {
  const { t } = useTranslation();
  const setPalette = useUi((s) => s.setPaletteOpen);
  useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const privacy = usePrefs((s) => s.privacy);
  const collapsed = usePrefs((s) => s.sidebarCollapsed);
  const simple = usePrefs((s) => s.simpleMode);
  const titleBar = usePrefs((s) => s.titleBar);
  const toggle = usePrefs((s) => s.toggle);
  const live = (useSyncStatus().data?.peers ?? []).filter((p) => p.connected).length;
  const { win, maximized } = useWindow();
  const custom = isTauri && os !== "mac" && titleBar === "custom";
  const dark = document.documentElement.classList.contains("dark");

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={(e) => {
        if (custom && e.target === e.currentTarget) win?.toggleMaximize();
      }}
      className={cn(
        "relative z-20 hidden h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/80 backdrop-blur-xl select-none md:flex",
        os === "mac" && isTauri ? "pl-[84px]" : "pl-3",
        custom ? "pr-0" : "pr-3",
      )}
    >
      <div data-tauri-drag-region className={cn("flex items-center gap-2 transition-[width] duration-300 ease-[var(--ease-out)]", collapsed && !simple ? "w-auto" : simple ? "w-auto pl-1" : "w-[13.25rem]")}>
        {!simple && (
          <ToolButton label={`${t("shell.sidebar")} · ${shortcutLabel("Mod+B")}`} onClick={() => toggle("sidebarCollapsed")}>
            <PanelLeft className="size-4" />
          </ToolButton>
        )}
        {(!collapsed || simple) && (
          <Link to="/" className="flex items-center gap-2 rounded-lg px-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <Logo />
            <span className="text-[13px] font-semibold tracking-tight">{t("app.name")}</span>
          </Link>
        )}
      </div>

      <ModeSwitch />
      <div data-tauri-drag-region className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex h-8 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-bg/70 px-2.5 text-[13px] text-muted transition-colors hover:border-muted/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-100"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">{t("shell.searchOrAdd")}</span>
          <Kbd>{shortcutLabel("Mod+K")}</Kbd>
        </button>
      </div>

      <div className="flex items-center gap-1">
        <Link
          to="/devices"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg"
        >
          <span className={cn("size-2 rounded-full", live ? "bg-income shadow-[0_0_0_3px] shadow-income/20" : "bg-border")} />
          <span className="hidden lg:inline">{live ? t("shell.devicesLive", { count: live }) : t("shell.local")}</span>
        </Link>
        <ToolButton
          label={`${privacy ? t("shell.showAmounts") : t("shell.hideAmounts")} · ${shortcutLabel("Mod+Shift+H")}`}
          onClick={() => toggle("privacy")}
          active={privacy}
        >
          {privacy ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </ToolButton>
        <ToolButton
          label={t("palette.toggleTheme")}
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </ToolButton>
      </div>

      {custom && win && <WindowControls maximized={maximized} onMin={() => win.minimize()} onMax={() => win.toggleMaximize()} onClose={() => win.close()} />}
    </header>
  );
}

export function ModeSwitch({ labels = false }: { labels?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const simple = usePrefs((s) => s.simpleMode);
  const set = usePrefs((s) => s.set);
  const go = (v: boolean) => {
    set("simpleMode", v);
    navigate({ to: v ? "/today" : "/" });
  };
  return (
    <div role="radiogroup" aria-label={t("mode.label")} className="flex shrink-0 rounded-lg bg-surface-2 p-0.5 text-[12px] font-medium">
      {([
        [true, t("mode.simple"), CalendarCheck2],
        [false, t("mode.full"), LayoutGrid],
      ] as const).map(([v, label, Icon]) => (
        <Tip key={label} label={v ? t("mode.simpleHint") : t("mode.fullHint")} side="bottom">
          <button
            type="button"
            role="radio"
            aria-checked={simple === v}
            onClick={() => go(v)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2.5 transition-colors active:scale-100",
              simple === v ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            <Icon className="size-3.5" />
            <span className={labels ? "inline" : "hidden lg:inline"}>{label}</span>
          </button>
        </Tip>
      ))}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return <img src={logo} alt="" aria-hidden draggable={false} className={cn("size-6 select-none", className)} />;
}

function WindowControls({ maximized, onMin, onMax, onClose }: { maximized: boolean; onMin: () => void; onMax: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  if (os === "windows") {
    const btn = "flex h-12 w-[46px] items-center justify-center text-fg/80 hover:bg-fg/8 active:scale-100";
    return (
      <div className="ml-1 flex self-stretch">
        <button type="button" aria-label={t("shell.minimize")} onClick={onMin} className={btn}>
          <Minus className="size-4" strokeWidth={1.5} />
        </button>
        <button type="button" aria-label={t("shell.maximize")} onClick={onMax} className={btn}>
          {maximized ? <RestoreIcon /> : <Square className="size-3.5" strokeWidth={1.5} />}
        </button>
        <button type="button" aria-label={t("common.close")} onClick={onClose} className={cn(btn, "hover:bg-[#c42b1c] hover:text-white")}>
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>
    );
  }
  const btn = "flex size-6 items-center justify-center rounded-full bg-surface-2 text-fg/75 hover:bg-border hover:text-fg active:scale-90";
  return (
    <div className="mr-3 ml-2 flex items-center gap-2.5">
      <button type="button" aria-label={t("shell.minimize")} onClick={onMin} className={btn}>
        <Minus className="size-3.5" strokeWidth={2.25} />
      </button>
      <button type="button" aria-label={t("shell.maximize")} onClick={onMax} className={btn}>
        {maximized ? <RestoreIcon small /> : <Square className="size-2.5" strokeWidth={2.5} />}
      </button>
      <button type="button" aria-label={t("common.close")} onClick={onClose} className={cn(btn, "hover:bg-expense hover:text-white")}>
        <X className="size-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
}

function RestoreIcon({ small }: { small?: boolean }) {
  const s = small ? 10 : 14;
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={small ? 1.8 : 1.2}>
      <rect x="1.5" y="4" width="8.5" height="8.5" rx="1" />
      <path d="M4 4V2.5a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H10" />
    </svg>
  );
}
