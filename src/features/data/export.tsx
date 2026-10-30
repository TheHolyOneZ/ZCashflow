import { useCallback, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { planning, type ExportOptions } from "@/lib/api";
import { systemLabels } from "@/lib/categories";
import { isoDate } from "@/lib/dates";
import { useAccounts, useCategories, useErrorMessage } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { usePrefs, type ExportCategories, type ExportExpenses } from "@/stores/prefs";
import { Segmented } from "@/components/ui/segmented";

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
  const expenses = usePrefs((s) => s.exportExpenses);
  const categoryColumns = usePrefs((s) => s.exportCategories);
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
          expenseMinus: expenses === "minus",
          splitCategories: categoryColumns === "split",
          ...opts,
        });
        toast(zip ? t("dataTransfer.exportedZip", { count: files }) : t("dataTransfer.exported"));
        return true;
      } catch (e) {
        toast(errorMessage(e), "error");
        return false;
      }
    },
    [t, i18n.language, toast, errorMessage, labels, expenses, categoryColumns],
  );
}

export function ExportColumnFields({ Wrap }: { Wrap: ComponentType<{ label: string; hint?: string; children: ReactNode }> }) {
  const { t } = useTranslation();
  const expenses = usePrefs((s) => s.exportExpenses);
  const categories = usePrefs((s) => s.exportCategories);
  const set = usePrefs((s) => s.set);
  return (
    <>
      <Wrap label={t("dataTransfer.expenseAmounts")} hint={t(expenses === "minus" ? "dataTransfer.expenseMinusHint" : "dataTransfer.expensePlainHint")}>
        <Segmented<ExportExpenses>
          aria-label={t("dataTransfer.expenseAmounts")}
          value={expenses}
          onChange={(v) => set("exportExpenses", v)}
          className="w-full"
          options={[
            { value: "minus", label: t("dataTransfer.expenseMinus") },
            { value: "plain", label: t("dataTransfer.expensePlain") },
          ]}
        />
      </Wrap>
      <Wrap label={t("dataTransfer.categoryColumns")} hint={t(categories === "path" ? "dataTransfer.categoryPathHint" : "dataTransfer.categorySplitHint")}>
        <Segmented<ExportCategories>
          aria-label={t("dataTransfer.categoryColumns")}
          value={categories}
          onChange={(v) => set("exportCategories", v)}
          className="w-full"
          options={[
            { value: "path", label: t("dataTransfer.categoryPath") },
            { value: "split", label: t("dataTransfer.categorySplit") },
          ]}
        />
      </Wrap>
    </>
  );
}
