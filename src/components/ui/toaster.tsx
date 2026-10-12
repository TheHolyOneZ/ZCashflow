import { useUi } from "@/stores/ui";
import { cn } from "@/lib/cn";

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={cn(
            "pointer-events-auto max-w-md rounded-lg px-3.5 py-2 text-[13px] font-medium shadow-lg animate-[toast-in_180ms_ease-out]",
            t.tone === "error" ? "bg-expense text-white" : "bg-fg text-bg",
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
