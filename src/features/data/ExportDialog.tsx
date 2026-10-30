import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { DateInput } from "@/components/ui/date-input";
import { DATASETS, type Dataset } from "@/lib/api";
import { isoDate } from "@/lib/dates";
import { CheckRow } from "./CheckRow";
import { defaultCsvFormat, ExportColumnFields, useExportFile, type CsvFormat } from "./export";

type Period = "all" | "year" | "last12" | "custom";

function periodRange(p: Period, from: string, to: string): { from?: string; to?: string } {
  const now = new Date();
  if (p === "year") return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  if (p === "last12") {
    const start = new Date(now);
    start.setFullYear(now.getFullYear() - 1);
    start.setDate(start.getDate() + 1);
    return { from: isoDate(start), to: isoDate(now) };
  }
  if (p === "custom") return { from: from || undefined, to: to || undefined };
  return {};
}

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("dataTransfer.exportTitle")} description={t("dataTransfer.exportHint")}>
      {open && <ExportForm onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function ExportForm({ onDone }: { onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const exportFile = useExportFile();
  const [selected, setSelected] = useState<Set<Dataset>>(new Set(DATASETS));
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState<CsvFormat>(defaultCsvFormat(i18n.language));
  const [busy, setBusy] = useState(false);
  const all = selected.size === DATASETS.length;

  const toggle = (d: Dataset) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  async function run() {
    setBusy(true);
    const datasets = DATASETS.filter((d) => selected.has(d));
    const ok = await exportFile({ datasets, filter: periodRange(period, from, to) }, datasets.length > 1 ? "zcashflow-export" : `zcashflow-${datasets[0]}`, format);
    setBusy(false);
    if (ok) onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label={t("dataTransfer.what")}>
        <div className="grid grid-cols-1 gap-1 rounded-xl border border-border p-1.5 sm:grid-cols-2">
          <CheckRow
            className="sm:col-span-2"
            checked={all}
            onChange={() => setSelected(all ? new Set() : new Set(DATASETS))}
            label={<span className="font-semibold">{t("dataTransfer.everything")}</span>}
          />
          {DATASETS.map((d) => (
            <CheckRow key={d} checked={selected.has(d)} onChange={() => toggle(d)} label={t(`dataTransfer.dataset.${d}`)} />
          ))}
        </div>
      </Field>
      {selected.has("transactions") && (
        <Field label={t("dataTransfer.period")}>
          <Segmented<Period>
            aria-label={t("dataTransfer.period")}
            value={period}
            onChange={setPeriod}
            className="w-full flex-wrap"
            options={[
              { value: "all", label: t("dataTransfer.periodAll") },
              { value: "year", label: t("dataTransfer.periodYear") },
              { value: "last12", label: t("dataTransfer.periodLast12") },
              { value: "custom", label: t("dataTransfer.periodCustom") },
            ]}
          />
          {period === "custom" && (
            <div className="flex items-center gap-1.5">
              <DateInput clearable aria-label={t("tx.filterFrom")} placeholder={t("tx.filterFrom")} value={from} onChange={setFrom} className="min-w-0 flex-1" />
              <span className="text-muted">–</span>
              <DateInput clearable aria-label={t("tx.filterTo")} placeholder={t("tx.filterTo")} value={to} onChange={setTo} className="min-w-0 flex-1" />
            </div>
          )}
        </Field>
      )}
      <Field label={t("dataTransfer.format")} hint={t(format === "excel" ? "dataTransfer.formatExcelHint" : "dataTransfer.formatStandardHint")}>
        <Segmented<CsvFormat>
          aria-label={t("dataTransfer.format")}
          value={format}
          onChange={setFormat}
          className="w-full"
          options={[
            { value: "excel", label: t("dataTransfer.formatExcel") },
            { value: "standard", label: t("dataTransfer.formatStandard") },
          ]}
        />
      </Field>
      {selected.has("transactions") && <ExportColumnFields Wrap={Field} />}
      {selected.size > 1 && <p className="text-[12px] text-muted">{t("dataTransfer.zipNote")}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={!selected.size || busy} onClick={run}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {t("dataTransfer.export")}
        </Button>
      </div>
    </div>
  );
}
