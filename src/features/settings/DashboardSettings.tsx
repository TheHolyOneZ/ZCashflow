import { useTranslation } from "react-i18next";
import { Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/extra";
import { DASHBOARD_WIDGETS, type StartPage, usePrefs } from "@/stores/prefs";

export function DashboardSettings() {
  const { t } = useTranslation();
  const startPage = usePrefs((s) => s.startPage);
  const hidden = usePrefs((s) => s.hiddenWidgets);
  const set = usePrefs((s) => s.set);
  const toggleWidget = usePrefs((s) => s.toggleWidget);
  const pages: StartPage[] = ["/", "/transactions", "/planner", "/receipts"];
  const label: Record<StartPage, string> = {
    "/": t("nav.dashboard"),
    "/transactions": t("nav.transactions"),
    "/planner": t("nav.planner"),
    "/receipts": t("nav.receipts"),
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr] sm:gap-6">
        <div>
          <div className="text-[13px] font-medium">{t("dashboardSettings.startPage")}</div>
          <div className="mt-0.5 text-[12px] text-muted">{t("dashboardSettings.startPageHint")}</div>
        </div>
        <Select
          aria-label={t("dashboardSettings.startPage")}
          value={startPage}
          onValueChange={(v) => set("startPage", v as StartPage)}
          items={pages.map((p) => ({ value: p, label: label[p] }))}
          className="max-w-xs"
        />
      </div>
      <div className="grid grid-cols-1 gap-2 border-t border-border pt-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
        <div>
          <div className="text-[13px] font-medium">{t("dashboardSettings.widgets")}</div>
          <div className="mt-0.5 text-[12px] text-muted">{t("dashboardSettings.widgetsHint")}</div>
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DASHBOARD_WIDGETS.map((w) => (
            <li key={w}>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2/60">
                <span className="text-[13px]">{t(`dashboardSettings.widgetNames.${w}`)}</span>
                <Switch checked={!hidden.includes(w)} onCheckedChange={() => toggleWidget(w)} />
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
