import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStatus } from "@/features/security/lock";
import { planning } from "@/lib/api";
import { isoDate } from "@/lib/dates";
import { useErrorMessage } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { pickSavePath } from "./export";

export function useSaveBackup() {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const encrypted = useVaultStatus().data?.enabled ?? false;
  return useCallback(async () => {
    try {
      const path = await pickSavePath(
        `zcashflow-backup-${isoDate()}.${encrypted ? "zcvault" : "db"}`,
        encrypted ? { name: "ZCashflow", extensions: ["zcvault"] } : { name: "SQLite", extensions: ["db"] },
      );
      if (!path) return false;
      await planning.backupDatabase(path);
      toast(t("settings.backedUpHint"));
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    }
  }, [encrypted, errorMessage, t, toast]);
}
