import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleSlash, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { SwitchRow } from "@/components/ui/extra";
import { planning, receipts, type SettingKey } from "@/lib/api";
import { invalidateData, useErrorMessage, useOcrStatus, useSettings } from "@/lib/queries";
import { useUi } from "@/stores/ui";

export function OcrSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useSettings().data ?? {};
  const status = useOcrStatus().data;
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const [url, setUrl] = useState(settings.llm_url ?? "http://localhost:11434");
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function set(key: SettingKey, value: string) {
    try {
      await planning.setSetting(key, value);
      await invalidateData(qc);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function loadModels() {
    setLoading(true);
    try {
      await set("llm_url", url);
      const list = await receipts.llmModels(url);
      setModels(list);
      if (!list.length) toast(t("ocr.noModels"), "error");
      else if (!settings.llm_model) await set("llm_model", list[0]);
    } catch (e) {
      setModels(null);
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  const llmOn = settings.llm_enabled === "1";
  const ok = (v: boolean) =>
    v ? <CheckCircle2 className="size-3.5 text-income" /> : <CircleSlash className="size-3.5 text-muted" />;

  return (
    <>
      <div className="flex flex-col gap-4">
        <Field label={t("ocr.engine")} htmlFor="ocr-engine">
          <Select id="ocr-engine" value={settings.ocr_engine ?? "auto"} onChange={(e) => set("ocr_engine", e.target.value)} className="max-w-xs">
            <option value="auto">{t("ocr.auto")}</option>
            <option value="tesseract" disabled={!status?.tesseract}>Tesseract</option>
            <option value="ocrs">{t("ocr.builtin")}</option>
          </Select>
        </Field>
        <ul className="flex flex-col gap-1 text-[12px] text-muted">
          <li className="flex items-center gap-1.5">
            {ok(!!status?.ocrs)} {t("ocr.builtinStatus")}
          </li>
          <li className="flex items-center gap-1.5">
            {ok(!!status?.tesseract)}{" "}
            {status?.tesseract
              ? `${status.tesseract} (${status.tesseractLangs.join(", ") || "–"})`
              : t("ocr.tesseractMissing")}
          </li>
        </ul>

        <div className="flex flex-col gap-3 rounded-xl bg-surface-2/60 p-3">
          <SwitchRow
            label={t("ocr.llm")}
            hint={t("ocr.llmHint")}
            checked={llmOn}
            onCheckedChange={(v) => set("llm_enabled", v ? "1" : "0")}
          />
          {llmOn && (
            <>
              <Field label={t("ocr.llmUrl")} htmlFor="llm-url">
                <div className="flex gap-2">
                  <Input id="llm-url" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => set("llm_url", url)} />
                  <Button onClick={loadModels} disabled={loading}>
                    <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
                    {t("ocr.connect")}
                  </Button>
                </div>
              </Field>
              <Field label={t("ocr.model")} htmlFor="llm-model">
                {models?.length ? (
                  <Select id="llm-model" value={settings.llm_model ?? ""} onChange={(e) => set("llm_model", e.target.value)}>
                    {models.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id="llm-model"
                    placeholder="qwen2.5vl:7b"
                    defaultValue={settings.llm_model ?? ""}
                    onBlur={(e) => set("llm_model", e.target.value.trim())}
                  />
                )}
              </Field>
              <SwitchRow
                label={t("ocr.vision")}
                hint={t("ocr.visionHint")}
                checked={settings.llm_vision === "1"}
                onCheckedChange={(v) => set("llm_vision", v ? "1" : "0")}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
