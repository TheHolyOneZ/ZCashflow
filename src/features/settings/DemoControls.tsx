import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { demo } from "@/lib/api";
import { useAppMutation } from "@/lib/queries";

export function DemoControls() {
  const { t, i18n } = useTranslation();
  const loaded = useQuery({ queryKey: ["demoLoaded"], queryFn: demo.loaded }).data;
  const [armed, setArmed] = useState(false);
  const load = useAppMutation(() => demo.load(i18n.language), { success: t("onboarding.demoLoaded") });
  const clear = useAppMutation(() => demo.clear(), { success: t("settings.demoRemoved") });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2/60 p-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{t("settings.demo")}</div>
        <div className="text-[12px] text-muted">{loaded ? t("settings.demoLoadedHint") : t("settings.demoHint")}</div>
      </div>
      {loaded ? (
        <Button
          variant={armed ? "danger" : "secondary"}
          disabled={clear.isPending}
          onBlur={() => setArmed(false)}
          onClick={() => (armed ? clear.mutate(undefined) : setArmed(true))}
        >
          <Trash2 className="size-4" />
          {armed ? t("common.confirmDelete") : t("settings.demoRemove")}
        </Button>
      ) : (
        <Button disabled={load.isPending} onClick={() => load.mutate(undefined)}>
          <Sparkles className="size-4" />
          {t("settings.demoLoad")}
        </Button>
      )}
    </div>
  );
}
