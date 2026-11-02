import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Loader2, LockKeyhole, TriangleAlert } from "lucide-react";
import { BareTitleBar, Logo } from "@/app/TitleBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { isApiError, vault } from "@/lib/api";
import { isTauri } from "@/lib/platform";
import { usePrefs } from "@/stores/prefs";
import { idleLimit, shouldLock } from "@/lib/autolock";
import { useLock, useVaultStatus } from "./lock";

type Phase = "checking" | "locked" | "open";

export function VaultGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(isTauri ? "checking" : "open");
  useEffect(() => {
    if (!isTauri) return;
    vault.status().then(
      (s) => setPhase(s.locked ? "locked" : "open"),
      () => setPhase("open"),
    );
  }, []);
  if (phase === "checking") return <div className="h-dvh bg-bg" />;
  if (phase === "locked") return <LockScreen startup onUnlocked={() => setPhase("open")} />;
  return (
    <>
      {children}
      <RuntimeLock />
    </>
  );
}

function RuntimeLock() {
  const enabled = useVaultStatus().data?.enabled ?? false;
  const locked = useLock((s) => s.locked);
  const lock = useLock((s) => s.lock);
  const unlock = useLock((s) => s.unlock);
  const lockAfter = usePrefs((s) => s.lockAfter);
  const lastActive = useRef(Date.now());
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => vault.flush().catch(() => {});
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        flush();
        if (enabled && lockAfter === "0") lock();
      } else if (hiddenAt.current !== null) {
        if (enabled && shouldLock(lockAfter, Date.now() - hiddenAt.current)) lock();
        hiddenAt.current = null;
        lastActive.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [enabled, lockAfter, lock]);

  useEffect(() => {
    const limit = idleLimit(lockAfter);
    if (!enabled || limit === null) return;
    const touch = () => {
      lastActive.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (!document.hidden && Date.now() - lastActive.current >= limit) lock();
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [enabled, lockAfter, lock]);

  if (!locked || !enabled) return null;
  return (
    <div className="fixed inset-0 z-[500]">
      <LockScreen
        onUnlocked={() => {
          lastActive.current = Date.now();
          unlock();
        }}
      />
    </div>
  );
}

function LockScreen({ startup, onUnlocked }: { startup?: boolean; onUnlocked: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgot, setForgot] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await (startup ? vault.unlock(password) : vault.verify(password));
      setPassword("");
      onUnlocked();
    } catch (err) {
      setError(isApiError(err) && err.message === "wrong_password" ? t("vault.wrongPassword") : t("vault.unlockFailed"));
      setPassword("");
      setBusy(false);
      setTimeout(() => input.current?.focus(), 0);
    }
  }

  async function reset() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setBusy(true);
    try {
      await vault.forget();
      onUnlocked();
    } catch {
      setBusy(false);
      setError(t("vault.unlockFailed"));
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <BareTitleBar />
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-8">
        <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
          <div className="relative">
            <Logo className="size-14" />
            <span className="absolute -right-2 -bottom-2 flex size-7 items-center justify-center rounded-full border-2 border-bg bg-accent text-accent-fg">
              <LockKeyhole className="size-3.5" />
            </span>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t("vault.lockedTitle")}</h1>
            <p className="mt-1 text-[13px] text-muted">{t("vault.lockedHint")}</p>
          </div>
          {!forgot ? (
            <form onSubmit={submit} className="flex w-full flex-col gap-3">
              <div className="relative">
                <Input
                  ref={input}
                  type={show ? "text" : "password"}
                  autoFocus
                  autoComplete="current-password"
                  aria-label={t("vault.password")}
                  placeholder={t("vault.password")}
                  value={password}
                  aria-invalid={!!error}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  className="h-11 pr-11 text-[15px]"
                />
                <button
                  type="button"
                  aria-label={show ? t("vault.hide") : t("vault.show")}
                  onClick={() => setShow((s) => !s)}
                  className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-fg"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {error && (
                <p role="alert" className="text-[13px] text-expense">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" disabled={!password || busy} className="h-11">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
                {t("vault.unlock")}
              </Button>
              <button type="button" onClick={() => setForgot(true)} className="text-[12px] text-muted hover:text-fg">
                {t("vault.forgot")}
              </button>
            </form>
          ) : (
            <div className="flex w-full flex-col gap-3 text-left">
              <div className="flex gap-2.5 rounded-xl bg-warn/10 p-3 text-[12.5px]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                <p>{startup ? t("vault.forgotText") : t("vault.forgotRestart")}</p>
              </div>
              {startup && (
                <Button variant={confirmReset ? "danger" : "secondary"} disabled={busy} onClick={reset}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {confirmReset ? t("vault.resetConfirm") : t("vault.reset")}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setForgot(false);
                  setConfirmReset(false);
                }}
              >
                {t("vault.back")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
