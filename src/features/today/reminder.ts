import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { isoDate } from "@/lib/dates";
import { planning } from "@/lib/api";
import { isTauri } from "@/lib/platform";
import { useSettings } from "@/lib/queries";

const LAST_KEY = "zc.dailyReminded";

export const REMINDER_TIMES = ["18:00", "19:00", "20:00", "21:00", "22:00"];

export function readDone(raw: string | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((d) => typeof d === "string") : [];
  } catch {
    return [];
  }
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function useDailyReminder() {
  const { t } = useTranslation();
  const at = useSettings().data?.daily_reminder ?? "";

  useEffect(() => {
    if (!isTauri || !REMINDER_TIMES.includes(at)) return;
    let cancelled = false;

    async function check() {
      const now = new Date();
      const today = isoDate(now);
      if (now.getHours() * 60 + now.getMinutes() < minutes(at)) return;
      try {
        if (localStorage.getItem(LAST_KEY) === today) return;
      } catch {
        return;
      }
      try {
        const settings = await planning.getSettings();
        if (cancelled || readDone(settings.daily_done).includes(today)) return;
        const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (!granted || cancelled) return;
        sendNotification({ title: t("today.reminderTitle"), body: t("today.reminderBody") });
        localStorage.setItem(LAST_KEY, today);
      } catch {
        return;
      }
    }

    const first = setTimeout(check, 5000);
    const timer = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [at, t]);
}
