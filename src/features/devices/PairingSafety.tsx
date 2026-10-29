import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { Select } from "@/components/ui/field";
import { sync, type PeerRole } from "@/lib/api";
import { cn } from "@/lib/cn";

export function PairWarning({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn("flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-left text-[12px] text-fg", className)}>
      <ShieldAlert className="mt-px size-4 shrink-0 text-warn" />
      <span>{t("sync.pairWarning")}</span>
    </p>
  );
}

export function PairingRolePicker({ role }: { role: PeerRole | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return (
    <label className="flex w-full flex-col gap-1.5 text-left">
      <span className="text-[12px] font-medium text-muted">{t("sync.pairingRole")}</span>
      <Select
        aria-label={t("sync.pairingRole")}
        value={role ?? "full"}
        onValueChange={async (v) => {
          await sync.setPairingRole(v as PeerRole).catch(() => {});
          await qc.invalidateQueries({ queryKey: ["syncStatus"] });
        }}
        items={(["full", "view", "capture"] as const).map((r) => ({
          value: r,
          label: t(`sync.roles.${r}`),
          text: t(`sync.roles.${r}`),
          hint: t(`sync.roleHints.${r}`),
        }))}
      />
    </label>
  );
}
