import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";

export function ErrorView({ error, reset }: { error: unknown; reset?: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
  return (
    <Card className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-expense/10 text-expense">
        <TriangleAlert className="size-6" />
      </span>
      <h1 className="text-[17px] font-semibold">{t("errors.pageTitle")}</h1>
      <p className="text-[13px] text-muted">{t("errors.pageHint")}</p>
      <pre className="max-h-32 w-full overflow-auto rounded-lg bg-surface-2 p-2 text-left text-[11px] whitespace-pre-wrap text-muted">{message}</pre>
      <Button
        variant="primary"
        onClick={() => {
          reset?.();
          router.invalidate();
        }}
      >
        <RotateCcw className="size-4" />
        {t("errors.retry")}
      </Button>
    </Card>
  );
}
