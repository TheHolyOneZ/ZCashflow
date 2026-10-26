import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, FileSpreadsheet, FileUp, Loader2, Upload } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Badge, Money, SwitchRow } from "@/components/ui/extra";
import { AccountSelect } from "@/components/selects";
import { planning, type ImportOptions, type ImportPreview } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDay } from "@/lib/dates";
import { invalidateData, useAccounts, useAppInfo, useErrorMessage } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { defaultCsvFormat, formatOptions, pickSavePath, useLabels } from "./export";

const COLUMNS = ["date", "type", "amount", "currency", "account", "to_account", "category", "counterparty", "title", "note", "tags", "reference"] as const;

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("dataTransfer.importTitle")} description={t("dataTransfer.importHint")} className="sm:max-w-2xl">
      {open && <ImportForm onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const labels = useLabels();
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archived);
  const currency = useAppInfo().data?.defaultCurrency ?? "EUR";
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [autoCategory, setAutoCategory] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [keepBalances, setKeepBalances] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showColumns, setShowColumns] = useState(false);

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accountId, accounts]);

  const options = (): ImportOptions => ({
    defaultAccountId: accountId || null,
    autoCategory,
    skipDuplicates,
    keepBalances,
    labels: labels(),
  });

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    planning
      .importPreview(file.text, options())
      .then(
        (p) => !cancelled && setPreview(p),
        (e) => {
          if (cancelled) return;
          setPreview(null);
          setFile(null);
          toast(errorMessage(e), "error");
        },
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [file, accountId, autoCategory, skipDuplicates]);

  async function choose(f: File | undefined) {
    if (!f) return;
    const buffer = await f.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buffer);
    setFile({ name: f.name, text });
  }

  async function template() {
    try {
      const path = await pickSavePath("zcashflow-import-template.csv", { name: "CSV", extensions: ["csv"] });
      if (!path) return;
      await planning.importTemplate(path, formatOptions(defaultCsvFormat(i18n.language)).delimiter);
      toast(t("dataTransfer.templateSaved"));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function run() {
    if (!file) return;
    setImporting(true);
    try {
      const r = await planning.importCommit(file.text, options());
      await invalidateData(qc);
      toast(t("dataTransfer.imported", { count: r.imported }) + (r.skipped ? ` · ${t("dataTransfer.skipped", { count: r.skipped })}` : ""));
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setImporting(false);
    }
  }

  const toImport = preview ? preview.validRows - (skipDuplicates ? preview.duplicates : 0) : 0;

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain,text/comma-separated-values,application/vnd.ms-excel"
        hidden
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant={file ? "secondary" : "primary"} onClick={() => fileRef.current?.click()}>
          <FileUp className="size-4" />
          {file ? t("dataTransfer.otherFile") : t("dataTransfer.chooseFile")}
        </Button>
        <Button variant="ghost" onClick={template}>
          <FileSpreadsheet className="size-4" />
          {t("dataTransfer.template")}
        </Button>
      </div>

      <div>
        <button type="button" onClick={() => setShowColumns((s) => !s)} className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-fg">
          <ChevronDown className={cn("size-3.5 transition-transform", showColumns && "rotate-180")} />
          {t("dataTransfer.columnsTitle")}
        </button>
        {showColumns && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border text-[12px]">
            {COLUMNS.map((c) => (
              <div key={c} className="grid grid-cols-[7.5rem_1fr] gap-3 border-t border-border px-3 py-1.5 first:border-0">
                <code className="font-mono text-[11px] text-accent">{c}</code>
                <span className="text-muted">{t(`dataTransfer.col.${c}`)}</span>
              </div>
            ))}
            <p className="border-t border-border bg-surface-2/60 px-3 py-2 text-muted">{t("dataTransfer.columnsNote")}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3">
        <Field label={t("dataTransfer.defaultAccount")} hint={t("dataTransfer.defaultAccountHint")}>
          <AccountSelect value={accountId} onChange={setAccountId} />
        </Field>
        <SwitchRow label={t("dataTransfer.autoCategory")} hint={t("dataTransfer.autoCategoryHint")} checked={autoCategory} onCheckedChange={setAutoCategory} />
        <SwitchRow label={t("dataTransfer.skipDuplicates")} hint={t("dataTransfer.skipDuplicatesHint")} checked={skipDuplicates} onCheckedChange={setSkipDuplicates} />
        <SwitchRow label={t("dataTransfer.keepBalances")} hint={t("dataTransfer.keepBalancesHint")} checked={keepBalances} onCheckedChange={setKeepBalances} />
      </div>

      {file && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <FileSpreadsheet className="size-4 text-accent" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            {loading && <Loader2 className="size-4 animate-spin text-muted" />}
          </div>
          {preview && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label={t("dataTransfer.rows")} value={preview.totalRows} />
                <Stat label={t("dataTransfer.ready")} value={toImport} tone="accent" />
                <Stat label={t("dataTransfer.duplicates")} value={preview.duplicates} />
                <Stat label={t("dataTransfer.errors")} value={preview.errors.length} tone={preview.errors.length ? "warn" : undefined} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                {preview.firstDate && preview.lastDate && (
                  <span>
                    {formatDay(preview.firstDate)} – {formatDay(preview.lastDate)}
                  </span>
                )}
                <span>
                  {t("dashboard.income")}: <Money minor={preview.incomeMinor} currency={currency} className="text-income" />
                </span>
                <span>
                  {t("dashboard.expenses")}: <Money minor={preview.expenseMinor} currency={currency} />
                </span>
              </div>
              {(preview.newAccounts.length > 0 || preview.newCategories.length > 0) && (
                <div className="flex flex-col gap-1.5 text-[12px]">
                  {preview.newAccounts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-muted">{t("dataTransfer.newAccounts")}:</span>
                      {preview.newAccounts.map((a) => (
                        <Badge key={a} tone="accent">{a}</Badge>
                      ))}
                    </div>
                  )}
                  {preview.newCategories.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-muted">{t("dataTransfer.newCategories")}:</span>
                      {preview.newCategories.map((c) => (
                        <Badge key={c} tone="accent">{c}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {preview.errors.length > 0 && (
                <div className="rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-[12px]">
                  <div className="mb-1 flex items-center gap-1.5 font-medium text-warn">
                    <AlertTriangle className="size-3.5" />
                    {t("dataTransfer.errorsTitle")}
                  </div>
                  <ul className="max-h-24 overflow-y-auto font-mono text-[11px]">
                    {preview.errors.slice(0, 20).map((e) => (
                      <li key={e.line}>
                        {t("dataTransfer.line", { line: e.line })}: {t(`dataTransfer.rowError.${e.code}`, { value: e.value })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.rows.length > 0 && (
                <div className="max-h-64 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-surface-2 text-left text-muted">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">{t("tx.date")}</th>
                        <th className="px-2 py-1.5 font-medium">{t("tx.title")}</th>
                        <th className="hidden px-2 py-1.5 font-medium sm:table-cell">{t("tx.category")}</th>
                        <th className="px-2 py-1.5 text-right font-medium">{t("tx.amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 100).map((r) => (
                        <tr key={r.line} className={cn("border-t border-border", r.duplicate && skipDuplicates && "opacity-45")}>
                          <td className="px-2 py-1 whitespace-nowrap">{formatDay(r.date)}</td>
                          <td className="max-w-48 truncate px-2 py-1">
                            {r.duplicate && <Badge className="mr-1">{t("dataTransfer.duplicate")}</Badge>}
                            {r.title || "—"}
                            <span className="block truncate text-[11px] text-muted">{r.account}</span>
                          </td>
                          <td className="hidden max-w-40 truncate px-2 py-1 text-muted sm:table-cell">{r.category || "—"}</td>
                          <td className="px-2 py-1 text-right">
                            <Money
                              minor={r.kind === "expense" ? -r.amountMinor : r.amountMinor}
                              currency={r.currency}
                              signed={r.kind === "income"}
                              className={r.kind === "income" ? "text-income" : r.kind === "transfer" ? "text-transfer" : undefined}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={!preview || !toImport || loading || importing} onClick={run}>
          {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {t("dataTransfer.importCount", { count: toImport })}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "accent" | "warn" }) {
  return (
    <div className="rounded-lg bg-surface-2/70 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn("text-[17px] font-semibold tabular", tone === "accent" && "text-accent", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}
