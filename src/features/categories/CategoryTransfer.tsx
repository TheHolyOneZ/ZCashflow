import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, FileJson, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconTile, icons } from "@/components/category-icon";
import { pickSavePath, useLabels } from "@/features/data/export";
import { api, type CategoryFile, type CategoryImportSummary } from "@/lib/api";
import { parseCategoryFile, type FileWarning } from "@/lib/category-file";
import { cn } from "@/lib/cn";
import { isoDate } from "@/lib/dates";
import { invalidateData, useErrorMessage } from "@/lib/queries";
import { useUi } from "@/stores/ui";

const EXAMPLE = `{
  "out": [
    {
      "name": "Housing",
      "symbol": "house",
      "color": "#2563eb",
      "subcategories": [
        { "name": "Rent", "symbol": "house", "subcategories": [] },
        { "name": "Electricity", "symbol": "zap", "subcategories": [] }
      ]
    }
  ],
  "in": [
    { "name": "Salary", "symbol": "briefcase", "subcategories": [] }
  ]
}`;

export function useExportCategories() {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const labels = useLabels();
  return async () => {
    try {
      const path = await pickSavePath(`zcashflow-categories-${isoDate()}.json`, { name: "JSON", extensions: ["json"] });
      if (!path) return;
      await api.exportCategories(path, labels());
      toast(t("categoryFile.exported"));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
}

export function CategoryImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("categoryFile.importTitle")} description={t("categoryFile.importHint")}>
      {open && <ImportForm onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const labels = useLabels();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [parsed, setParsed] = useState<{ file: CategoryFile; warnings: FileWarning[] } | null>(null);
  const [summary, setSummary] = useState<CategoryImportSummary | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);

  async function choose(f: File | undefined) {
    if (!f) return;
    setName(f.name);
    setParsed(null);
    setSummary(null);
    setProblem("");
    const r = parseCategoryFile(await f.text(), Object.keys(icons));
    if (!r.ok) {
      setProblem(t(`categoryFile.error.${r.error}`));
      return;
    }
    try {
      setSummary(await api.importCategories(r.file, labels(), true));
      setParsed({ file: r.file, warnings: r.warnings });
    } catch (e) {
      setProblem(errorMessage(e));
    }
  }

  async function run() {
    if (!parsed) return;
    setBusy(true);
    try {
      const r = await api.importCategories(parsed.file, labels(), false);
      await invalidateData(qc);
      toast(t("categoryFile.imported", { created: r.created, updated: r.updated }));
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json,text/plain"
        hidden
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={parsed ? "secondary" : "primary"} onClick={() => fileRef.current?.click()}>
          <FileJson className="size-4" />
          {name ? t("dataTransfer.otherFile") : t("dataTransfer.chooseFile")}
        </Button>
        {name && <span className="min-w-0 truncate text-[12px] text-muted">{name}</span>}
      </div>

      {problem && (
        <p role="alert" className="rounded-lg bg-expense/10 px-3 py-2 text-[13px] text-expense">
          {problem}
        </p>
      )}

      {summary && (
        <dl className="grid grid-cols-3 gap-2 rounded-xl border border-border p-3 text-center">
          {[
            [t("categoryFile.created"), summary.created],
            [t("categoryFile.updated"), summary.updated],
            [t("categoryFile.unchanged"), summary.unchanged],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-medium text-muted">{label}</dt>
              <dd className="text-[17px] font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {parsed && parsed.warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg bg-warn/10 px-3 py-2 text-[12px]">
          <span className="flex items-center gap-1.5 font-medium text-warn">
            <AlertTriangle className="size-3.5" />
            {t("categoryFile.warnings", { count: parsed.warnings.length })}
          </span>
          <ul className="max-h-28 overflow-y-auto text-muted">
            {parsed.warnings.map((w, i) => (
              <li key={i} className="truncate">
                {w.path}: {w.kind === "name" ? t("categoryFile.noName") : t(`categoryFile.bad.${w.kind}`, { value: w.value })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setHelp((h) => !h)}
          aria-expanded={help}
          className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-fg"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", help && "rotate-180")} />
          {t("categoryFile.format")}
        </button>
        {help && (
          <div className="mt-2 flex flex-col gap-2 text-[12px] text-muted">
            <p>{t("categoryFile.formatHint")}</p>
            <pre className="max-h-56 overflow-auto rounded-lg bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-fg">{EXAMPLE}</pre>
            <p className="font-medium text-fg">{t("categoryFile.icons")}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(icons).map((icon) => (
                <span key={icon} className="flex items-center gap-1.5 rounded-md bg-surface-2 py-0.5 pr-2 pl-0.5 font-mono text-[11px] text-fg">
                  <IconTile icon={icon} color="var(--accent)" className="size-5 rounded-[6px]" iconClassName="size-3" />
                  {icon}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={!parsed || busy || !summary} onClick={run}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {t("categoryFile.import")}
        </Button>
      </div>
    </div>
  );
}
