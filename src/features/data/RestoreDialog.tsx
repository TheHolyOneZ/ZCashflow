import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArchiveRestore, FileUp, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { SwitchRow } from "@/components/ui/extra";
import { isApiError, planning, type BackupSummary } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import { invalidateData, useErrorMessage, useSyncStatus } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { useSaveBackup } from "./backup";

export function RestoreDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("restore.title")} description={t("restore.intro")}>
      {open && <RestoreForm onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

type Picked = { name: string; bytes: Uint8Array };

function RestoreForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const saveBackup = useSaveBackup();
  const paired = (useSyncStatus().data?.peers.length ?? 0) > 0;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<Picked | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupFirst, setBackupFirst] = useState(true);

  async function inspect(picked: Picked, pw?: string) {
    setBusy(true);
    setError("");
    try {
      setSummary(await planning.inspectBackup(picked.bytes, pw));
      setNeedsPassword(!!pw);
    } catch (e) {
      const code = isApiError(e) ? e.message : "";
      if (code === "password_required") setNeedsPassword(true);
      else if (code === "wrong_password") setError(t("vault.wrongPassword"));
      else setError(errorMessage(e));
      setSummary(null);
    } finally {
      setBusy(false);
    }
  }

  async function choose(f: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    const picked = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
    setFile(picked);
    setNeedsPassword(false);
    setPassword("");
    setSummary(null);
    await inspect(picked);
  }

  function unlock(e: FormEvent) {
    e.preventDefault();
    if (file && password) inspect(file, password);
  }

  async function restore() {
    if (!file || !summary) return;
    setBusy(true);
    if (backupFirst && !(await saveBackup())) {
      setBusy(false);
      return;
    }
    try {
      const done = await planning.restoreBackup(file.bytes, needsPassword ? password : undefined);
      await invalidateData(qc);
      toast(t("restore.done", { count: done.transactions }));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={file ? "secondary" : "primary"} disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileUp className="size-4" />
          {file ? t("restore.other") : t("restore.choose")}
        </Button>
        {file && <span className="min-w-0 truncate text-[12.5px] text-muted">{file.name}</span>}
      </div>

      {needsPassword && !summary && (
        <form onSubmit={unlock} className="flex flex-col gap-2">
          <p className="flex items-start gap-2 text-[13px]">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-accent" />
            {t("restore.passwordNeeded")}
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              autoFocus
              autoComplete="off"
              aria-label={t("restore.password")}
              placeholder={t("restore.password")}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
            />
            <Button type="submit" variant="primary" disabled={!password || busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("restore.continue")}
            </Button>
          </div>
        </form>
      )}

      {busy && !summary && !needsPassword && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="size-4 animate-spin" />
          {t("restore.reading")}
        </p>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-expense">
          {error}
        </p>
      )}

      {summary && (
        <>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-2/50 p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-medium">
              <span>{t("restore.entries", { count: summary.transactions })}</span>
              <span>{t("restore.accounts", { count: summary.accounts })}</span>
              {summary.encrypted && (
                <span className="flex items-center gap-1 text-[12px] text-accent">
                  <LockKeyhole className="size-3.5" />
                  {t("restore.encrypted")}
                </span>
              )}
            </div>
            {summary.firstOn && summary.lastOn && (
              <span className="text-[12px] text-muted">
                {t("restore.range", { from: formatDay(summary.firstOn), to: formatDay(summary.lastOn) })}
              </span>
            )}
          </div>
          <div className="flex gap-3 rounded-xl bg-warn/10 p-3 text-[12.5px]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">{t("restore.warnTitle")}</p>
              <p className="text-muted">{t("restore.warnText")}</p>
              {paired && <p className="text-muted">{t("restore.warnSync")}</p>}
            </div>
          </div>
          <SwitchRow label={t("restore.backupFirst")} hint={t("restore.backupFirstHint")} checked={backupFirst} onCheckedChange={setBackupFirst} />
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        <Button variant="danger" disabled={!summary || busy} onClick={restore}>
          {busy && summary ? <Loader2 className="size-4 animate-spin" /> : <ArchiveRestore className="size-4" />}
          {busy && summary ? t("restore.working") : t("restore.confirm")}
        </Button>
      </div>
    </div>
  );
}
