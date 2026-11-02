import { useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, LockKeyhole, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { isApiError, vault } from "@/lib/api";
import { usePrefs, type LockAfter } from "@/stores/prefs";
import { useUi } from "@/stores/ui";
import { useLock, useVaultStatus } from "./lock";

type Mode = "set" | "change" | "remove";

const MIN = 4;

export function SecuritySettings({ Wrap }: { Wrap: ComponentType<{ label: string; hint?: string; children: ReactNode }> }) {
  const { t } = useTranslation();
  const enabled = useVaultStatus().data?.enabled ?? false;
  const lockAfter = usePrefs((s) => s.lockAfter);
  const setPref = usePrefs((s) => s.set);
  const lock = useLock((s) => s.lock);
  const [mode, setMode] = useState<Mode | null>(null);

  return (
    <div className="flex flex-col">
      <Wrap label={t("vault.protection")} hint={enabled ? t("vault.onHint") : t("vault.offHint")}>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              enabled
                ? "flex items-center gap-1.5 text-[13px] font-medium text-income"
                : "flex items-center gap-1.5 text-[13px] font-medium text-muted"
            }
          >
            {enabled ? <ShieldCheck className="size-4" /> : <ShieldOff className="size-4" />}
            {enabled ? t("vault.on") : t("vault.off")}
          </span>
          {!enabled && (
            <Button size="sm" variant="primary" onClick={() => setMode("set")}>
              <KeyRound className="size-3.5" />
              {t("vault.set")}
            </Button>
          )}
        </div>
      </Wrap>
      {enabled && (
        <>
          <Wrap label={t("vault.lockAfter")} hint={t("vault.lockAfterHint")}>
            <Select
              aria-label={t("vault.lockAfter")}
              value={lockAfter}
              onValueChange={(v) => setPref("lockAfter", v as LockAfter)}
              items={[
                { value: "0", label: t("vault.lockHidden") },
                { value: "1", label: t("vault.lockMinutes", { count: 1 }) },
                { value: "5", label: t("vault.lockMinutes", { count: 5 }) },
                { value: "15", label: t("vault.lockMinutes", { count: 15 }) },
                { value: "never", label: t("vault.lockStart") },
              ]}
            />
          </Wrap>
          <Wrap label={t("vault.manage")}>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={lock}>
                <LockKeyhole className="size-3.5" />
                {t("vault.lockNow")}
              </Button>
              <Button size="sm" onClick={() => setMode("change")}>
                <KeyRound className="size-3.5" />
                {t("vault.change")}
              </Button>
              <Button size="sm" variant="ghost" className="text-expense hover:text-expense" onClick={() => setMode("remove")}>
                <ShieldOff className="size-3.5" />
                {t("vault.remove")}
              </Button>
            </div>
          </Wrap>
        </>
      )}
      <p className="border-t border-border pt-3 text-[12px] text-muted">{t("vault.perDevice")}</p>
      <Dialog
        open={!!mode}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode === "set" ? t("vault.set") : mode === "change" ? t("vault.change") : t("vault.remove")}
        description={mode === "remove" ? t("vault.removeHint") : undefined}
      >
        {mode && <PasswordForm mode={mode} onDone={() => setMode(null)} />}
      </Dialog>
    </div>
  );
}

function PasswordForm({ mode, onDone }: { mode: Mode; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsNew = mode !== "remove";
  const needsCurrent = mode !== "set";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (needsNew && next.length < MIN) return setError(t("vault.tooShort", { count: MIN }));
    if (needsNew && next !== repeat) return setError(t("vault.mismatch"));
    setBusy(true);
    setError("");
    try {
      if (mode === "set") await vault.enable(next);
      if (mode === "change") await vault.changePassword(current, next);
      if (mode === "remove") await vault.disable(current);
      await qc.invalidateQueries({ queryKey: ["vaultStatus"] });
      toast(t(mode === "set" ? "vault.enabled" : mode === "change" ? "vault.changed" : "vault.removed"));
      onDone();
    } catch (err) {
      setBusy(false);
      setError(isApiError(err) && err.message === "wrong_password" ? t("vault.wrongPassword") : isApiError(err) ? err.message : t("vault.unlockFailed"));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {mode === "set" && (
        <div className="flex gap-2.5 rounded-xl bg-warn/10 p-3 text-[12.5px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t("vault.warnTitle")}</p>
            <p className="text-muted">{t("vault.warnText")}</p>
          </div>
        </div>
      )}
      {needsCurrent && (
        <Field label={t("vault.current")} htmlFor="vault-current">
          <Input id="vault-current" type="password" autoFocus autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
      )}
      {needsNew && (
        <>
          <Field label={t("vault.new")} htmlFor="vault-new" hint={t("vault.tooShort", { count: MIN })}>
            <Input id="vault-new" type="password" autoFocus={!needsCurrent} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label={t("vault.repeat")} htmlFor="vault-repeat">
            <Input id="vault-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
        </>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-expense">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        <Button type="submit" variant={mode === "remove" ? "danger" : "primary"} disabled={busy || (needsCurrent && !current) || (needsNew && !next)}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === "set" ? t("vault.set") : mode === "change" ? t("vault.change") : t("vault.remove")}
        </Button>
      </div>
    </form>
  );
}
