import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, ImageOff, Loader2, RefreshCw, ScanLine, Trash2, Unlink, X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { RowMenu, type MenuEntry } from "@/components/ui/context-menu";
import { receipts, type Attachment } from "@/lib/api";
import { cn } from "@/lib/cn";
import { invalidateData, useAppMutation, useAttachmentImage, useErrorMessage } from "@/lib/queries";
import { useUi } from "@/stores/ui";

export const CAMERA_ACCEPT = "image/*";

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/bmp,image/tiff,image/heic,image/heif,application/pdf,.pdf,.heic,.heif";

export function useReceiptImport() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const setProcessing = useUi((s) => s.setProcessing);
  const openReceipt = useUi((s) => s.openReceipt);
  const errorMessage = useErrorMessage();

  return useCallback(
    async (files: File[] | FileList, opts: { transactionId?: string; review?: boolean } = {}) => {
      const list = Array.from(files).filter(
        (f) => f.type.startsWith("image/") || f.type === "application/pdf" || /\.(jpe?g|png|webp|bmp|tiff?|pdf|heic|heif)$/i.test(f.name),
      );
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

function useReceiptActions(a: Attachment | null) {
  const { t } = useTranslation();
  const del = useAppMutation((id: string) => receipts.delete(id), { success: t("common.deleted") });
  const unlink = useAppMutation((id: string) => receipts.link(id, null), { success: t("receipts.unlinked") });
  return {
    remove: () => (a ? del.mutateAsync(a.id) : Promise.resolve()),
    unlink: () => (a ? unlink.mutateAsync(a.id) : Promise.resolve()),
  };
}

export function ReceiptMenu({
  attachment: a,
  onView,
  children,
}: {
  attachment: Attachment;
  onView?: () => void;
  children: ReactElement;
}) {
  const { t } = useTranslation();
  const openReceipt = useUi((s) => s.openReceipt);
  const reprocess = useAppMutation(() => receipts.reprocess(a.id), { success: t("receipts.reprocessed") });
  const actions = useReceiptActions(a);
  const items: MenuEntry[] = a.transactionId
    ? [
        ...(onView ? [{ label: t("receipts.show"), icon: Eye, onSelect: onView }] : []),
        { label: t("receipts.unlink"), icon: Unlink, onSelect: () => void actions.unlink().catch(() => {}) },
        "separator",
        { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => void actions.remove().catch(() => {}) },
      ]
    : [
        { label: t("receipts.review"), icon: ScanLine, onSelect: () => openReceipt(a) },
        { label: t("receipts.rerun"), icon: RefreshCw, onSelect: () => reprocess.mutate(undefined) },
        "separator",
        { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => void actions.remove().catch(() => {}) },
      ];
  return <RowMenu items={items}>{children}</RowMenu>;
}

export function Lightbox({
  attachment,
  onClose,
  actions = true,
}: {
  attachment: Attachment | null;
  onClose: () => void;
  actions?: boolean;
}) {
  const { t } = useTranslation();
  const { data: url } = useAttachmentImage(attachment?.available ? attachment.id : undefined, false);
  const [zoom, setZoom] = useState(false);
  const [armed, setArmed] = useState(false);
  const act = useReceiptActions(attachment);
  useEffect(() => setArmed(false), [attachment?.id]);
  const run = (fn: () => Promise<unknown>) => () =>
    fn()
      .then(onClose)
      .catch(() => {});
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
          {attachment && actions && (
            <div
              className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              {attachment.transactionId && (
                <button
                  type="button"
                  onClick={run(act.unlink)}
                  className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[13px] font-medium whitespace-nowrap text-white hover:bg-white/20"
                >
                  <Unlink className="size-4" />
                  {t("receipts.unlink")}
                </button>
              )}
              <button
                type="button"
                onClick={armed ? run(act.remove) : () => setArmed(true)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium whitespace-nowrap text-white",
                  armed ? "bg-expense hover:bg-expense/90" : "bg-white/10 hover:bg-white/20",
                )}
              >
                <Trash2 className="size-4" />
                {armed ? t("common.confirmDelete") : t("common.delete")}
              </button>
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
