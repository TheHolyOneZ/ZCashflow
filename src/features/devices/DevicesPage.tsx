import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, Laptop, LifeBuoy, Link2, Loader2, Plug, Radar, RefreshCw, ShieldCheck, Smartphone, Unlink, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge, SwitchRow } from "@/components/ui/extra";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/misc";
import { planning, sync, type PeerRole, type PeerView } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDay } from "@/lib/dates";
import { useErrorMessage, useSyncStatus } from "@/lib/queries";
import { useUi } from "@/stores/ui";
import { writeClipboard } from "@/lib/clipboard";
import { os } from "@/lib/platform";
import { PairingRolePicker, PairWarning } from "./PairingSafety";

function useAction() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  return async <T,>(fn: () => Promise<T>, success?: string) => {
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      toast(errorMessage(e), "error");
      return undefined;
    } finally {
      await qc.invalidateQueries({ queryKey: ["syncStatus"] });
    }
  };
}

export function DevicesPage() {
  const { t } = useTranslation();
  const { data: status, isError } = useSyncStatus(true);
  const run = useAction();
  const [joinTarget, setJoinTarget] = useState<{ addr: string; name?: string } | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    sync.scan().catch(() => {});
  }, []);

  if (isError) {
    return (
      <>
        <PageHeader title={t("nav.devices")} />
        <Card>
          <EmptyState icon={<WifiOff className="size-8" />} title={t("sync.unavailable")} />
        </Card>
      </>
    );
  }
  if (!status) return null;

  const paired = status.peers.filter((p) => p.paired);
  const nearby = status.peers.filter((p) => !p.paired);

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <PageHeader title={t("nav.devices")} subtitle={t("sync.subtitle")} />

      <Card className="grid grid-cols-1 gap-0 overflow-hidden md:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Laptop className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <Input
                aria-label={t("sync.deviceName")}
                value={name ?? status.name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name !== null && name.trim() && run(() => planning.setSetting("device_name", name.trim()))}
                className="h-8 border-transparent px-1.5 text-[15px] font-semibold hover:border-border"
              />
              <div className="mt-0.5 flex items-center gap-1.5 px-1.5 text-[12px] text-muted">
                <ShieldCheck className="size-3.5 text-accent" />
                <span className="font-mono">{status.fingerprint}</span>
              </div>
            </div>
          </div>
          <SwitchRow
            label={t("sync.enabled")}
            hint={t("sync.enabledHint")}
            checked={status.enabled}
            onCheckedChange={(v) => run(() => sync.setEnabled(v))}
          />
          <SwitchRow
            label={t("sync.discoverable")}
            hint={t("sync.discoverableHint")}
            checked={status.discoverable}
            onCheckedChange={(v) => run(() => planning.setSetting("discoverable", v ? "1" : "0"))}
          />
        </div>
        <PairingPanel code={status.pairingCode} expiresIn={status.pairingExpiresIn} role={status.pairingRole} />
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={t("sync.paired", { count: paired.length })} />
        {paired.length === 0 ? (
          <EmptyState icon={<Link2 className="size-8" />} title={t("sync.noPaired")} hint={t("sync.noPairedHint")} />
        ) : (
          <ul className="divide-y divide-border">
            {paired.map((p) => (
              <PairedRow key={p.publicKey} peer={p} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title={
            <span className="flex items-center gap-1.5">
              <Radar className="size-3.5" />
              {t("sync.nearby")}
            </span>
          }
          action={
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={status.scanning} onClick={() => sync.scan().catch(() => {})}>
                {status.scanning ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {status.scanning ? t("sync.scanning") : t("sync.scan")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setJoinTarget({ addr: "" })}>
                <Plug className="size-3.5" />
                {t("sync.byAddress")}
              </Button>
            </div>
          }
        />
        {nearby.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-muted">{status.scanning ? t("sync.scanningHint") : t("sync.nobodyNearby")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {nearby.map((p) => (
              <li key={p.publicKey} className="flex items-center gap-3 px-4 py-3">
                <DeviceIcon />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-[12px] text-muted">{p.addr}</div>
                </div>
                <Button size="sm" variant="primary" onClick={() => setJoinTarget({ addr: p.addr ?? "", name: p.name })}>
                  {t("sync.pair")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-border px-4 py-2.5 text-[12px] text-muted">
          {t("sync.thisDeviceAt")} <span className="font-mono text-fg">{status.addresses.join(", ") || `:${status.port}`}</span>
        </p>
        <SyncHelp port={status.port > 0 ? status.port : 47811} />
      </Card>

      <Dialog
        open={!!joinTarget}
        onOpenChange={(o) => !o && setJoinTarget(null)}
        title={joinTarget?.name ? t("sync.pairWith", { name: joinTarget.name }) : t("sync.pairDevice")}
      >
        {joinTarget && <JoinForm initialAddr={joinTarget.addr} targetName={joinTarget.name} onDone={() => setJoinTarget(null)} />}
      </Dialog>
    </div>
  );
}

function CommandRow({ command }: { command: string }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  return (
    <li className="flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg">{command}</code>
      <button
        type="button"
        aria-label={t("menu.copy")}
        onClick={() => writeClipboard(command).then(() => toast(t("menu.copied")))}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg"
      >
        <Copy className="size-3.5" />
      </button>
    </li>
  );
}

type HelpPlatform = "windows" | "mac" | "linux" | "mobile";

function SyncHelp({ port }: { port: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const commands: Record<HelpPlatform, string[]> = {
    windows: [
      `New-NetFirewallRule -DisplayName "ZCashflow" -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private`,
    ],
    mac: [],
    linux: [`sudo firewall-cmd --permanent --add-port=${port}/tcp && sudo firewall-cmd --reload`, `sudo ufw allow ${port}/tcp`],
    mobile: [],
  };
  const order: HelpPlatform[] = [os, ...(["windows", "mac", "linux", "mobile"] as const).filter((p) => p !== os)];
  return (
    <div className="border-t border-border px-4 py-3 text-[12.5px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left font-medium text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <LifeBuoy className="size-4 shrink-0" />
        <span className="flex-1">{t("syncHelp.title")}</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-4 text-muted">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            {(["sameWifi", "bothOpen", "vpn", "byAddress"] as const).map((k) => (
              <li key={k}>{t(`syncHelp.${k}`, { port, button: t("sync.byAddress"), label: t("sync.thisDeviceAt") })}</li>
            ))}
          </ul>
          {order.map((p) => (
            <div key={p} className="flex flex-col gap-1.5">
              <div className="font-medium text-fg">
                {t(`syncHelp.${p}Title`)}
                {p === os && <span className="ml-1.5 text-[11px] font-normal text-accent">{t("syncHelp.thisDevice")}</span>}
              </div>
              <p>{t(`syncHelp.${p}Text`, { port })}</p>
              {commands[p].length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {commands[p].map((c) => (
                    <CommandRow key={c} command={c} />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceIcon({ connected }: { connected?: boolean }) {
  return (
    <span className="relative flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted">
      <Smartphone className="size-4" />
      {connected !== undefined && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface",
            connected ? "bg-income" : "bg-border",
          )}
        />
      )}
    </span>
  );
}

function PairingPanel({ code, expiresIn, role }: { code: string | null; expiresIn: number | null; role: PeerRole | null }) {
  const { t } = useTranslation();
  const run = useAction();
  return (
    <div className="flex flex-col items-center justify-center gap-3 border-t border-border bg-surface-2/50 p-5 text-center md:border-t-0 md:border-l">
      {code ? (
        <>
          <span className="text-[12px] font-medium text-muted">{t("sync.showCode")}</span>
          <span className="font-mono text-[34px] leading-none font-semibold tracking-[0.12em]">
            {code.slice(0, 3)} {code.slice(3)}
          </span>
          <span className="text-[12px] text-muted">
            {t("sync.codeValid", { seconds: expiresIn ?? 0 })}
          </span>
          <PairingRolePicker role={role} />
          <PairWarning />
          <Button size="sm" variant="ghost" onClick={() => run(() => sync.stopPairing())}>
            {t("common.cancel")}
          </Button>
        </>
      ) : (
        <>
          <Wifi className="size-6 text-accent" />
          <p className="text-[13px] text-muted">{t("sync.pairIntro")}</p>
          <Button variant="primary" onClick={() => run(() => sync.startPairing())}>
            {t("sync.showPairingCode")}
          </Button>
        </>
      )}
    </div>
  );
}

function PairedRow({ peer: p }: { peer: PeerView }) {
  const { t } = useTranslation();
  const run = useAction();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <DeviceIcon connected={p.connected} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{p.name}</span>
          {p.connected ? <Badge tone="income">{t("sync.live")}</Badge> : <Badge>{t("sync.offline")}</Badge>}
        </div>
        <div className="text-[12px] text-muted">
          {p.connected
            ? p.addr
            : p.lastSeen
              ? t("sync.lastSeen", { date: formatDay(p.lastSeen.slice(0, 10)) })
              : t("sync.neverSeen")}
        </div>
      </div>
      <Select
        aria-label={t("sync.role")}
        value={p.role ?? "full"}
        onValueChange={(v) => run(() => sync.setRole(p.publicKey, v as PeerRole), t("common.saved"))}
        className="w-44"
        items={(["full", "view", "capture"] as const).map((r) => ({
          value: r,
          label: t(`sync.roles.${r}`),
          text: t(`sync.roles.${r}`),
          hint: t(`sync.roleHints.${r}`),
        }))}
      />
      {!p.connected && p.addr && (
        <Button size="sm" onClick={() => run(() => sync.connect(p.addr!))}>
          <Plug className="size-3.5" />
          {t("sync.connect")}
        </Button>
      )}
      <Button
        size="sm"
        variant={confirm ? "danger" : "ghost"}
        onBlur={() => setConfirm(false)}
        onClick={() => (confirm ? run(() => sync.unpair(p.publicKey), t("sync.unpaired")) : setConfirm(true))}
      >
        <Unlink className="size-3.5" />
        {confirm ? t("sync.confirmUnpair") : t("sync.unpair")}
      </Button>
    </li>
  );
}

function JoinForm({ initialAddr, targetName, onDone }: { initialAddr: string; targetName?: string; onDone: () => void }) {
  const { t } = useTranslation();
  const run = useAction();
  const [addr, setAddr] = useState(initialAddr);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  async function requestCode(target = addr) {
    if (!target.trim()) return;
    setRequesting(true);
    const name = await run(() => sync.requestPairing(target));
    setRequesting(false);
    if (name) setRequested(name);
  }

  useEffect(() => {
    if (initialAddr) void requestCode(initialAddr);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const name = await run(() => sync.pair(addr, code.replace(/\D/g, "")));
    setBusy(false);
    if (name) {
      useUi.getState().toast(t("sync.pairedWith", { name }));
      onDone();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!initialAddr && (
        <Field label={t("sync.address")} htmlFor="join-addr" hint={t("sync.addressHint")}>
          <div className="flex gap-2">
            <Input id="join-addr" required value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="192.168.0.23" className="font-mono" />
            <Button type="button" disabled={!addr.trim() || requesting} onClick={() => requestCode()} className="shrink-0">
              {t("sync.requestCode")}
            </Button>
          </div>
        </Field>
      )}
      <div className="flex items-center gap-2.5 rounded-xl bg-accent-soft px-3.5 py-3 text-[12.5px]">
        {requesting ? <Loader2 className="size-4 shrink-0 animate-spin text-accent" /> : <Wifi className="size-4 shrink-0 text-accent" />}
        <span>
          {requesting
            ? t("sync.requesting")
            : requested
              ? t("sync.codeShownOn", { name: requested })
              : t("sync.codeHowTo", { name: targetName ?? t("sync.otherDevice") })}
        </span>
      </div>
      <PairWarning />
      <Field label={t("sync.code")} htmlFor="join-code">
        <Input
          id="join-code"
          autoFocus={!!initialAddr}
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123 456"
          className="h-12 text-center font-mono text-2xl tracking-[0.3em]"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={busy || code.replace(/\D/g, "").length !== 6}>
          {busy ? t("sync.pairing") : t("sync.pair")}
        </Button>
      </div>
    </form>
  );
}
