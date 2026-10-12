import { activeLocale } from "@/lib/i18n";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Money, ProgressBar, SwitchRow } from "@/components/ui/extra";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { isTauri, os } from "@/lib/platform";
import {
  ACCENTS,
  type Accent,
  type Density,
  type FontChoice,
  type Motion,
  type Radius,
  type TitleBar,
  usePrefs,
} from "@/stores/prefs";
import { useUi, type Theme } from "@/stores/ui";

const THEME_SWATCH: Record<Exclude<Theme, "system">, { bg: string; surface: string; border: string; fg: string }> = {
  light: { bg: "#f7f7f5", surface: "#ffffff", border: "#e4e4df", fg: "#1a1a18" },
  dark: { bg: "#111312", surface: "#181b1a", border: "#2c312f", fg: "#ecefed" },
  midnight: { bg: "#000000", surface: "#0b0b0c", border: "#222225", fg: "#ecefed" },
};

function MiniWindow({ theme, accent }: { theme: Exclude<Theme, "system">; accent: string }) {
  const c = THEME_SWATCH[theme];
  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: c.bg }}>
      <div className="flex w-[28%] flex-col gap-1 p-1.5" style={{ background: c.surface, borderRight: `1px solid ${c.border}` }}>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: accent, opacity: 0.9 }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: c.fg, opacity: 0.15 }} />
        <div className="h-1 w-1/2 rounded-full" style={{ background: c.fg, opacity: 0.15 }} />
        <div className="h-1 w-3/5 rounded-full" style={{ background: c.fg, opacity: 0.15 }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-1.5">
        <div className="h-1.5 w-1/3 rounded-full" style={{ background: c.fg, opacity: 0.55 }} />
        <div className="flex flex-1 gap-1.5">
          <div className="flex-1 rounded" style={{ background: c.surface, border: `1px solid ${c.border}` }} />
          <div className="flex-1 rounded" style={{ background: c.surface, border: `1px solid ${c.border}` }} />
        </div>
        <div className="h-[30%] rounded" style={{ background: c.surface, border: `1px solid ${c.border}` }} />
      </div>
    </div>
  );
}

function OptionCard({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className="group flex flex-col gap-1.5 text-left focus-visible:outline-none active:scale-100"
    >
      <span
        className={cn(
          "relative block overflow-hidden rounded-xl border-2 transition-[border-color,box-shadow] duration-150",
          active ? "border-accent shadow-[0_0_0_4px] shadow-ring" : "border-border group-hover:border-muted/50 group-focus-visible:border-accent",
        )}
      >
        {children}
        {active && (
          <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-accent-fg">
            <Check className="size-2.5" strokeWidth={3.5} />
          </span>
        )}
      </span>
      <span className={cn("text-[12px] font-medium", active ? "text-fg" : "text-muted")}>{label}</span>
    </button>
  );
}

function Row({ label, hint, children, stacked }: { label: string; hint?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={cn("grid grid-cols-1 gap-2 border-t border-border py-4 first:border-0 first:pt-0", stacked ? "gap-3" : "sm:grid-cols-[11rem_1fr] sm:gap-6")}>
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function AppearanceSettings() {
  const { t } = useTranslation();
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const p = usePrefs();
  const dark = document.documentElement.classList.contains("dark");

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <div>
        <Row label={t("appearance.theme")} stacked>
          <div role="radiogroup" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["system", "light", "dark", "midnight"] as const).map((th) => (
              <OptionCard key={th} active={theme === th} onClick={() => setTheme(th)} label={t(`settings.themes.${th}`)}>
                <span className="block aspect-[16/10]">
                  {th === "system" ? (
                    <span className="flex h-full">
                      <span className="w-1/2 overflow-hidden">
                        <span className="block h-full w-[200%]">
                          <MiniWindow theme="light" accent={ACCENTS[p.accent].light} />
                        </span>
                      </span>
                      <span className="w-1/2 overflow-hidden">
                        <span className="-ml-[100%] block h-full w-[200%]">
                          <MiniWindow theme="dark" accent={ACCENTS[p.accent].dark} />
                        </span>
                      </span>
                    </span>
                  ) : (
                    <MiniWindow theme={th} accent={ACCENTS[p.accent][th === "light" ? "light" : "dark"]} />
                  )}
                </span>
              </OptionCard>
            ))}
          </div>
        </Row>

        <Row label={t("appearance.accent")} hint={t("appearance.accentHint")} stacked>
          <div role="radiogroup" className="flex flex-wrap gap-2.5">
            {(Object.keys(ACCENTS) as Accent[]).map((a) => {
              const active = p.accent === a;
              const color = ACCENTS[a][dark ? "dark" : "light"];
              return (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={t(`appearance.accents.${a}`)}
                  title={t(`appearance.accents.${a}`)}
                  onClick={() => p.set("accent", a)}
                  className={cn(
                    "relative flex size-9 items-center justify-center rounded-full transition-transform duration-150 ease-[var(--ease-out)] hover:scale-110 focus-visible:outline-none active:scale-95",
                    active && "ring-2 ring-offset-2 ring-offset-surface",
                  )}
                  style={{ background: color, ["--tw-ring-color" as string]: color }}
                >
                  {active && <Check className="size-4" strokeWidth={3} style={{ color: dark ? "#0a0a0a" : "#fff" }} />}
                </button>
              );
            })}
          </div>
        </Row>

        <Row label={t("appearance.font")} stacked>
          <div role="radiogroup" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["inter", "geist", "manrope", "system"] as FontChoice[]).map((f) => (
              <OptionCard key={f} active={p.font === f} onClick={() => p.set("font", f)} label={t(`appearance.fonts.${f}`)}>
                <span
                  className="flex aspect-[16/10] flex-col justify-center bg-surface-2/60 px-4"
                  style={{
                    fontFamily:
                      f === "inter"
                        ? '"Inter Variable"'
                        : f === "geist"
                          ? '"Geist Variable"'
                          : f === "manrope"
                            ? '"Manrope Variable"'
                            : "ui-sans-serif, system-ui, sans-serif",
                  }}
                >
                  <span className="text-[26px] leading-none font-semibold tracking-tight">Aa</span>
                  <span className="mt-2 text-[12px] whitespace-nowrap text-muted tabular-nums">{new Intl.NumberFormat(activeLocale(), { style: "currency", currency: "EUR" }).format(1234.56)}</span>
                </span>
              </OptionCard>
            ))}
          </div>
        </Row>

        <Row label={t("appearance.density")} hint={t("appearance.densityHint")}>
          <Segmented<Density>
            aria-label={t("appearance.density")}
            value={p.density}
            onChange={(v) => p.set("density", v)}
            options={(["compact", "comfortable", "spacious"] as const).map((v) => ({ value: v, label: t(`appearance.densities.${v}`) }))}
          />
        </Row>

        <Row label={t("appearance.radius")}>
          <div role="radiogroup" className="flex gap-2">
            {(["sharp", "soft", "round"] as Radius[]).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={p.radius === r}
                onClick={() => p.set("radius", r)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium",
                  p.radius === r ? "border-accent bg-accent-soft text-fg" : "border-border text-muted hover:text-fg",
                )}
              >
                <span
                  className="size-4 border-2 border-current border-r-0 border-b-0"
                  style={{ borderTopLeftRadius: r === "sharp" ? 2 : r === "soft" ? 6 : 12 }}
                />
                {t(`appearance.radii.${r}`)}
              </button>
            ))}
          </div>
        </Row>

        <Row label={t("appearance.scale")} hint={t("appearance.scaleHint")}>
          <Segmented<string>
            aria-label={t("appearance.scale")}
            value={String(p.scale)}
            onChange={(v) => p.set("scale", Number(v))}
            options={["0.9", "1", "1.1", "1.25"].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)} %` }))}
          />
        </Row>

        <Row label={t("appearance.motion")}>
          <Segmented<Motion>
            aria-label={t("appearance.motion")}
            value={p.motion}
            onChange={(v) => p.set("motion", v)}
            options={(["system", "full", "reduced"] as const).map((v) => ({ value: v, label: t(`appearance.motions.${v}`) }))}
          />
        </Row>

        {isTauri && os !== "mac" && os !== "mobile" && (
          <Row label={t("appearance.titleBar")} hint={t("appearance.titleBarHint")}>
            <Segmented<TitleBar>
              aria-label={t("appearance.titleBar")}
              value={p.titleBar}
              onChange={(v) => p.set("titleBar", v)}
              options={(["custom", "system"] as const).map((v) => ({ value: v, label: t(`appearance.titleBars.${v}`) }))}
            />
          </Row>
        )}

        <Row label={t("appearance.privacy")} hint={t("appearance.privacyHint")}>
          <div className="flex flex-col gap-3">
            <SwitchRow label={t("shell.hideAmounts")} checked={p.privacy} onCheckedChange={(v) => p.set("privacy", v)} />
            <SwitchRow label={t("appearance.revealOnHover")} checked={p.revealOnHover} onCheckedChange={(v) => p.set("revealOnHover", v)} />
          </div>
        </Row>

        <div className="border-t border-border pt-4">
          <Button variant="ghost" onClick={() => p.reset()}>
            <RotateCcw className="size-4" />
            {t("appearance.reset")}
          </Button>
        </div>
      </div>

      <aside className="hidden xl:block">
        <div className="sticky top-4 flex flex-col gap-3">
          <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{t("appearance.preview")}</span>
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-bg p-3">
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="text-[11px] font-medium text-muted">{t("dashboard.balance")}</div>
              <Money minor={1166226} currency="EUR" className="text-[22px] font-semibold tracking-tight" />
              <div className="mt-2 flex gap-1.5">
                <Badge tone="accent">+4,2 %</Badge>
                <Badge tone="income">{t("goals.onTrack")}</Badge>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="mb-1.5 flex justify-between text-[12px]">
                <span className="font-medium">{t("appearance.sampleBudget")}</span>
                <Money minor={17480} currency="EUR" className="text-muted" />
              </div>
              <ProgressBar value={0.72} />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" className="flex-1 justify-center">
                {t("tx.new")}
              </Button>
              <Button size="sm">{t("common.cancel")}</Button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
