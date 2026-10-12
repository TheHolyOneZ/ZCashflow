import type { ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <D.Content
          className={cn(
            "fixed z-50 flex max-h-[92dvh] outline-none flex-col overflow-hidden border border-border bg-surface shadow-2xl",
            "inset-x-0 bottom-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
            "sm:inset-x-0 sm:top-[12vh] sm:bottom-auto sm:mx-auto sm:w-full sm:max-w-lg sm:rounded-2xl sm:pb-0",
            "data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.2,0.9,0.3,1)]",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
            <div className="min-w-0">
              <D.Title className="text-[15px] font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="mt-0.5 text-[13px] text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close
              aria-label={t("common.close")}
              className="-mr-2 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 pb-5">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
