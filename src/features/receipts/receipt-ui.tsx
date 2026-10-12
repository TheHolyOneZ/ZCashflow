import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ImageOff, Loader2, X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { receipts, type Attachment } from "@/lib/api";
import { cn } from "@/lib/cn";
import { invalidateData, useAttachmentImage, useErrorMessage } from "@/lib/queries";
import { useUi } from "@/stores/ui";

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/bmp,image/tiff";

export function useReceiptImport() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const setProcessing = useUi((s) => s.setProcessing);
  const openReceipt = useUi((s) => s.openReceipt);
  const errorMessage = useErrorMessage();

  return useCallback(
    async (files: File[] | FileList, opts: { transactionId?: string; review?: boolean } = {}) => {
      const list = Array.from(files).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(f.name));
      if (!list.length) return [];
      const done: Attachment[] = [];
      setProcessing(list.length);
      try {
        for (const f of list) {
          try {
            done.push(await receipts.import(f, { fileName: f.name, transactionId: opts.transactionId }));
          } catch (e) {
            toast(errorMessage(e), "error");
          } finally {
            setProcessing(-1);
          }
        }
      } finally {
        await invalidateData(qc);
      }
      if (done.length === 1 && opts.review !== false && !opts.transactionId) openReceipt(done[0]);
      else if (done.length > 1) toast(t("receipts.imported", { count: done.length }));
      return done;
    },
    [qc, toast, setProcessing, openReceipt, errorMessage, t],
  );
}

export function ReceiptThumb({
  attachment,
  className,
  onClick,
}: {
  attachment: Attachment;
  className?: string;
  onClick?: () => void;
}) {
  const { data: url, isLoading, isError } = useAttachmentImage(attachment.available ? attachment.id : undefined, true);
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-muted",
        onClick && "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {url ? (
        <img src={url} alt={attachment.fileName ?? ""} className="size-full object-cover" draggable={false} />
      ) : isLoading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ImageOff className={cn("size-4", isError && "text-expense")} />
      )}
    </Wrapper>
  );
}

export function Lightbox({ attachment, onClose }: { attachment: Attachment | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: url } = useAttachmentImage(attachment?.available ? attachment.id : undefined, false);
  const [zoom, setZoom] = useState(false);
  return (
    <D.Root open={!!attachment} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[70] bg-black/85" />
        <D.Content className="fixed inset-0 z-[70] flex items-center justify-center overflow-auto p-4 focus:outline-none" onClick={onClose}>
          <D.Title className="sr-only">{attachment?.fileName ?? t("receipts.receipt")}</D.Title>
          <D.Description className="sr-only">{t("receipts.receipt")}</D.Description>
          {url && (
            <img
              src={url}
              alt=""
              onClick={(e) => {
                e.stopPropagation();
                setZoom((z) => !z);
              }}
              className={cn(
                "rounded-lg shadow-2xl transition-[max-width,max-height] duration-200",
                zoom ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in",
              )}
            />
          )}
          <D.Close
            aria-label={t("common.close")}
            className="fixed top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="size-5" />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
