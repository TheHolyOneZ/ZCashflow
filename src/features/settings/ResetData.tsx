import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { SwitchRow } from "@/components/ui/extra";
import { invoke } from "@tauri-apps/api/core";
import { planning } from "@/lib/api";
import { isoDate } from "@/lib/dates";
import { useErrorMessage } from "@/lib/queries";
import { usePrefs } from "@/stores/prefs";
import { useUi } from "@/stores/ui";

export function ResetData() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const resetLook = usePrefs((s) => s.reset);
  const toast = useUi((s) => s.toast);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{t("reset.lookTitle")}</div>
          <div className="text-[12px] text-muted">{t("reset.lookHint")}</div>
        </div>
        <Button
          onClick={() => {
            resetLook();
            useUi.getState().setTheme("system");
            toast(t("reset.lookDone"));
          }}
        >
          <RotateCcw className="size-4" />
          {t("reset.lookButton")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-expense/35 bg-expense/5 p-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-expense">{t("reset.allTitle")}</div>
          <div className="text-[12px] text-muted">{t("reset.allHint")}</div>
        </div>
        <Button variant="danger" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" />
          {t("reset.allButton")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={t("reset.dialogTitle")}>
        {open && <ResetForm onCancel={() => setOpen(false)} />}
      </Dialog>
    </div>
  );
}

function ResetForm({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const [backup, setBackup] = useState(true);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const required = t("reset.word");
  const fold = (v: string) =>
    v.trim().toUpperCase().replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const ok = fold(word) === fold(required);

  async function run() {
    setBusy(true);
    try {
      if (backup) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({
          defaultPath: `zcashflow-backup-${isoDate()}.db`,
          filters: [{ name: "SQLite", extensions: ["db"] }],
        });
        if (!path) {
          setBusy(false);
          return;
        }
        await planning.backupDatabase(path);
      }
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith("zc."))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        void 0;
      }
      await invoke("reset_all_data");
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 rounded-xl bg-expense/8 p-3 text-[13px]">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-expense" />
        <div>
          <p className="font-medium">{t("reset.warningTitle")}</p>
          <ul className="mt-1 list-disc pl-4 text-muted">
            <li>{t("reset.item1")}</li>
            <li>{t("reset.item2")}</li>
            <li>{t("reset.item3")}</li>
          </ul>
        </div>
      </div>
      <SwitchRow label={t("reset.backupFirst")} hint={t("reset.backupHint")} checked={backup} onCheckedChange={setBackup} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px]">{t("reset.typeToConfirm", { word: required })}</span>
        <Input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" placeholder={required} className="font-mono tracking-wider" />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="danger" disabled={!ok || busy} onClick={run}>
          <Trash2 className="size-4" />
          {busy ? t("reset.working") : t("reset.confirm")}
        </Button>
      </div>
    </div>
  );
}
