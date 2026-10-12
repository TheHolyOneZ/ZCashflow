import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Smartphone } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sync } from "@/lib/api";
import { useSyncStatus } from "@/lib/queries";

export function PairRequestDialog() {
  const { t } = useTranslation();
  const status = useSyncStatus(false).data;
  const request = status?.pairingRequest ?? null;
  const code = status?.pairingCode ?? null;
  const [left, setLeft] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const open = !!request && !!code && dismissed !== code;

  useEffect(() => {
    if (!open) return;
    setLeft(status?.pairingExpiresIn ?? 0);
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [open, status?.pairingExpiresIn]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && code) {
          setDismissed(code);
          sync.stopPairing().catch(() => {});
        }
      }}
      title={t("sync.pairRequestTitle", { name: request ?? "" })}
    >
      <div className="flex flex-col items-center gap-4 pb-1 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Smartphone className="size-6" />
        </span>
        <p className="text-[13px] text-muted">{t("sync.pairRequestText", { name: request ?? "" })}</p>
        <div className="font-mono text-[40px] font-semibold tracking-[0.25em] tabular-nums">
          {code ? `${code.slice(0, 3)} ${code.slice(3)}` : ""}
        </div>
        <div className="h-1 w-48 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, (left / 180) * 100)}%` }} />
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            if (code) setDismissed(code);
            sync.stopPairing().catch(() => {});
          }}
        >
          {t("sync.pairRequestDeny")}
        </Button>
      </div>
    </Dialog>
  );
}
