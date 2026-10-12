import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Coffee, Gamepad2, Globe, Heart, ShieldCheck } from "lucide-react";
import logo from "@/assets/logo.png";
import { useAppInfo } from "@/lib/queries";
import { isTauri } from "@/lib/platform";
import { cn } from "@/lib/cn";

export const LINKS = {
  repo: "https://github.com/TheHolyOneZ/ZCashflow",
  author: "https://github.com/TheHolyOneZ",
  zsync: "https://zsync.eu",
  zlogic: "https://zlogic.eu/",
  kofi: "https://ko-fi.com/theholyonez",
  website: "https://zsync.eu/zcashflow/",
};

const STACK = ["Tauri 2", "Rust", "React 19", "TypeScript", "SQLite", "Tailwind CSS", "Noise Protocol", "OCR (ocrs · Tesseract)"];

export function openLink(url: string) {
  if (isTauri) {
    import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url)).catch(() => window.open(url, "_blank"));
  } else {
    window.open(url, "_blank", "noopener");
  }
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function LinkRow({ icon, title, hint, url }: { icon: ReactNode; title: string; hint: string; url: string }) {
  return (
    <button
      type="button"
      onClick={() => openLink(url)}
      className="group flex w-full items-center gap-3 rounded-xl border border-border px-3.5 py-3 text-left transition-colors hover:border-accent/50 hover:bg-surface-2/60 active:scale-100"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg group-hover:bg-surface">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block truncate text-[12px] text-muted">{hint}</span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
    </button>
  );
}

export function About() {
  const { t } = useTranslation();
  const info = useAppInfo().data;
  return (
    <div className="flex flex-col gap-5">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_16%,transparent),transparent_60%)] p-5">
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--accent)_22%,transparent),transparent_70%)]" />
        <div className="relative flex flex-wrap items-center gap-4">
          <img src={logo} alt="" draggable={false} className="size-16 rounded-[18px] shadow-[0_10px_30px_-10px_rgb(0_0_0/0.5)] select-none" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-[22px] font-semibold tracking-tight">ZCashflow</h3>
              {info?.version && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent">v{info.version}</span>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-muted">{t("about.tagline")}</p>
          </div>
        </div>
        <p className="relative mt-4 max-w-2xl text-[13px] leading-relaxed">{t("about.description")}</p>
        <div className="relative mt-4 flex flex-wrap gap-1.5">
          {STACK.map((s) => (
            <span key={s} className="rounded-md border border-border bg-surface/70 px-2 py-0.5 text-[11.5px] font-medium text-muted">
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent),color-mix(in_srgb,var(--accent)_40%,#000))] text-[15px] font-bold text-accent-fg">
          Z
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-medium text-muted uppercase tracking-wide">{t("about.author")}</div>
          <div className="text-[14px] font-semibold">TheHolyOneZ</div>
        </div>
        <button
          type="button"
          onClick={() => openLink(LINKS.author)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors hover:border-accent/50 hover:text-accent active:scale-100"
        >
          <GithubMark className="size-3.5" />
          GitHub
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <LinkRow icon={<GithubMark className="size-4" />} title={t("about.repo")} hint="github.com/TheHolyOneZ/ZCashflow" url={LINKS.repo} />
        <LinkRow icon={<Globe className="size-4" />} title={t("about.website")} hint="zsync.eu/zcashflow" url={LINKS.website} />
        <LinkRow icon={<Globe className="size-4" />} title={t("about.moreProjects")} hint="zsync.eu" url={LINKS.zsync} />
        <LinkRow icon={<Gamepad2 className="size-4" />} title={t("about.gameMods")} hint="zlogic.eu" url={LINKS.zlogic} />
      </div>

      <button
        type="button"
        onClick={() => openLink(LINKS.kofi)}
        className={cn(
          "group flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-white transition-[filter,transform] active:scale-[0.99]",
          "bg-[linear-gradient(135deg,#ff5e5b,#ff8a5b)] shadow-[0_12px_30px_-12px_#ff5e5b] hover:brightness-110",
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
          <Coffee className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">{t("about.kofi")}</span>
          <span className="block text-[12px] text-white/85">{t("about.kofiHint")}</span>
        </span>
        <Heart className="size-4 fill-white/90 text-white/90 transition-transform group-hover:scale-125" />
      </button>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-t border-border pt-4 text-[12.5px]">
        <dt className="text-muted">{t("settings.version")}</dt>
        <dd>{info?.version}</dd>
        <dt className="text-muted">{t("settings.deviceId")}</dt>
        <dd className="font-mono text-[11.5px] break-all">{info?.deviceId}</dd>
        <dt className="text-muted">{t("about.license")}</dt>
        <dd className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-accent" />
          GPL-3.0-or-later · {t("about.privacy")}
        </dd>
      </dl>
    </div>
  );
}
