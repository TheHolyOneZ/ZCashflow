import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { planning, type ExportOptions } from "@/lib/api";
import { systemLabels } from "@/lib/categories";
import { isoDate } from "@/lib/dates";
import { useAccounts, useCategories, useErrorMessage } from "@/lib/queries";
import { useUi } from "@/stores/ui";

export type CsvFormat = "excel" | "standard";

export function defaultCsvFormat(language: string): CsvFormat {
  return language.startsWith("en") ? "standard" : "excel";
}

export function formatOptions(format: CsvFormat) {
  return format === "excel" ? { delimiter: ";", decimalComma: true } : { delimiter: ",", decimalComma: false };
}

export async function pickSavePath(defaultPath: string, filter: { name: string; extensions: string[] }) {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath, filters: [filter] });
}

export function useLabels() {
  const categories = useCategories().data ?? [];
  const accounts = useAccounts().data ?? [];
  return useCallback(() => systemLabels(categories, accounts), [categories, accounts]);
}

export function useExportFile() {
  const { t, i18n } = useTranslation();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const labels = useLabels();
  return useCallback(
    async (opts: Pick<ExportOptions, "datasets"> & Partial<ExportOptions>, baseName: string, format?: CsvFormat) => {
      const zip = opts.datasets.length > 1;
      try {
        const path = await pickSavePath(
          `${baseName}-${isoDate()}.${zip ? "zip" : "csv"}`,
          zip ? { name: "ZIP", extensions: ["zip"] } : { name: "CSV", extensions: ["csv"] },
        );
        if (!path) return false;
        const files = await planning.exportData(path, {
          ...formatOptions(format ?? defaultCsvFormat(i18n.language)),
          labels: labels(),
          ...opts,
        });
        toast(zip ? t("dataTransfer.exportedZip", { count: files }) : t("dataTransfer.exported"));
        return true;
      } catch (e) {
        toast(errorMessage(e), "error");
        return false;
      }
    },
    [t, i18n.language, toast, errorMessage, labels],
  );
}
