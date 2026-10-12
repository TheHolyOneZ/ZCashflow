import type { ReactElement } from "react";
import { RefreshCw, Trash2, Camera, FolderOpen, Inbox, Loader2, ScanLine, Sparkles } from "lucide-react";
import { RowMenu, type MenuEntry } from "@/components/ui/context-menu";
import { receipts } from "@/lib/api";
import { useAppMutation, useAttachments, useTransactions } from "@/lib/queries";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/misc";
import { Badge, Money } from "@/components/ui/extra";
import type { Attachment } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import { useUi } from "@/stores/ui";
import { IMAGE_ACCEPT, Lightbox, ReceiptThumb, useReceiptImport } from "./receipt-ui";

export function ReceiptsPage() {
  const { t } = useTranslation();
  const inbox = useAttachments({ inbox: true }).data ?? [];
  const all = useAttachments().data ?? [];
  const linked = all.filter((a) => a.transactionId).slice(0, 24);
  const txs = useTransactions({ limit: 1000 }).data ?? [];
  const processing = useUi((s) => s.processing);
  const openReceipt = useUi((s) => s.openReceipt);
  const openEditTx = useUi((s) => s.openEditTx);
  const importFiles = useReceiptImport();
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("nav.receipts")} subtitle={t("receipts.subtitle")} />

      <Card className="relative overflow-hidden">
        <div className="flex flex-col items-center gap-4 px-6 py-10 text-center sm:flex-row sm:text-left">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            {processing > 0 ? <Loader2 className="size-7 animate-spin" /> : <ScanLine className="size-7" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">
              {processing > 0 ? t("receipts.processing", { count: processing }) : t("receipts.scanTitle")}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">{t("receipts.scanHint")}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => cameraRef.current?.click()}>
              <Camera className="size-4" />
              {t("receipts.takePhoto")}
            </Button>
            <Button onClick={() => filesRef.current?.click()}>
              <FolderOpen className="size-4" />
              {t("receipts.chooseFiles")}
            </Button>
          </div>
        </div>

        <input
          ref={cameraRef}
          type="file"
          accept={IMAGE_ACCEPT}
          capture="environment"
          hidden
          onChange={(e) => {
            if (e.target.files) importFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={filesRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) importFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title={
            <span className="flex items-center gap-1.5">
              <Inbox className="size-3.5" />
              {t("receipts.inbox", { count: inbox.length })}
            </span>
          }
        />
        {inbox.length === 0 ? (
          <EmptyState title={t("receipts.inboxEmpty")} hint={t("receipts.inboxHint")} />
        ) : (
          <ul className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {inbox.map((a) => (
              <ReceiptMenu key={a.id} attachment={a}>
              <li>
                <button
                  type="button"
                  onClick={() => openReceipt(a)}
                  className="group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface text-left hover:border-accent/50 active:scale-[0.98]"
                >
                  <ReceiptThumb attachment={a} className="aspect-[4/3] w-full rounded-none" />
                  <div className="flex flex-col gap-0.5 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{a.extracted?.merchant ?? t("receipts.unknownMerchant")}</span>
                      {a.extracted?.source === "llm" && <Sparkles className="size-3 shrink-0 text-accent" />}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
                      <span>{a.extracted?.date ? formatDay(a.extracted.date) : formatDay(a.createdAt.slice(0, 10))}</span>
                      {a.extracted?.totalMinor ? (
                        <Money minor={a.extracted.totalMinor} currency={a.extracted.currency ?? "EUR"} className="font-semibold text-fg" />
                      ) : (
                        <Badge tone="warn">?</Badge>
                      )}
                    </div>
                  </div>
                </button>
              </li>
              </ReceiptMenu>
            ))}
          </ul>
        )}
      </Card>

      {linked.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title={t("receipts.recentlyBooked")} />
          <ul className="grid grid-cols-3 gap-2 px-4 pb-4 sm:grid-cols-6 lg:grid-cols-8">
            {linked.map((a) => {
              const tx = txs.find((x) => x.id === a.transactionId);
              return (
                <li key={a.id} className="flex flex-col gap-1">
                  <ReceiptThumb attachment={a} className="aspect-[3/4] w-full cursor-zoom-in" onClick={() => setLightbox(a)} />
                  {tx && (
                    <button type="button" onClick={() => openEditTx(tx)} className="truncate text-left text-[11px] text-muted hover:text-fg">
                      {tx.title || tx.counterpartyName}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Lightbox attachment={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function ReceiptMenu({ attachment: a, children }: { attachment: Attachment; children: ReactElement }) {
  const { t } = useTranslation();
  const openReceipt = useUi((s) => s.openReceipt);
  const del = useAppMutation(() => receipts.delete(a.id), { success: t("common.deleted") });
  const reprocess = useAppMutation(() => receipts.reprocess(a.id), { success: t("receipts.reprocessed") });
  const items: MenuEntry[] = [
    { label: t("receipts.review"), icon: ScanLine, onSelect: () => openReceipt(a) },
    { label: t("receipts.rerun"), icon: RefreshCw, onSelect: () => reprocess.mutate(undefined) },
    "separator",
    { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => del.mutate(undefined) },
  ];
  return <RowMenu items={items}>{children}</RowMenu>;
}
