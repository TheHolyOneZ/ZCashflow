import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { addDays, parseISO } from "date-fns";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  History,
  FolderOpen,
  LayoutDashboard,
  Link2,
  Minus,
  Paperclip,
  Plus,
  Repeat,
  ScanLine,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { Money, MoneyInput } from "@/components/ui/extra";
import { Select } from "@/components/ui/select";
import { CategoryIcon } from "@/components/category-icon";
import { AccountSelect, CounterpartyInput } from "@/components/selects";
import { api, planning, receipts, type Attachment, type Category, type Transaction, type TxKind } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDay, isoDate } from "@/lib/dates";
import { activeLocale, displayName } from "@/lib/i18n";
import { isTauri, os } from "@/lib/platform";
import { minorDigits, parseMoney } from "@/lib/money";
import {
  invalidateData,
  useAccounts,
  useAppMutation,
  useAttachments,
  useCategories,
  useDeleteTransaction,
  useErrorMessage,
  useForecast,
  useSettings,
  useTransactions,
} from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { IMAGE_ACCEPT, ReceiptThumb, useReceiptImport } from "@/features/receipts/receipt-ui";
import { usePrefs } from "@/stores/prefs";
import { readDone } from "./reminder";
import { REPEAT_PRESETS, type RepeatPreset } from "@/features/recurring/rule-input";
import { IncomeCheck } from "./IncomeCheck";
import { CatchupBanner, CatchupStart, daysBetween, useCatchup } from "./Catchup";
import { useUi } from "@/stores/ui";

const LAST_ACCOUNT = "zc.lastAccount";

function streak(done: Set<string>): number {
  let day = new Date();
  if (!done.has(isoDate(day))) day = addDays(day, -1);
  let n = 0;
  while (done.has(isoDate(day))) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

function signed(t: Transaction) {
  return t.kind === "income" ? t.amountMinor : t.kind === "expense" ? -t.amountMinor : 0;
}

export function TodayPage() {
  const { t } = useTranslation();
  const [day, setDay] = useState(isoDate());
  const [finished, setFinished] = useState(false);
  const today = isoDate();
  const isToday = day === today;
  const entries = useTransactions({ from: day, to: day, limit: 200 }).data ?? [];
  const forecast = useForecast(30).data;
  const settings = useSettings().data ?? {};
  const done = useMemo(() => new Set(readDone(settings.daily_done)), [settings.daily_done]);
  const qc = useQueryClient();

  const spent = entries.filter((e) => e.kind === "expense").reduce((s, e) => s + e.amountMinor, 0);
  const earned = entries.filter((e) => e.kind === "income").reduce((s, e) => s + e.amountMinor, 0);
  const currency = entries[0]?.currency ?? forecast?.currency ?? "EUR";
  const leftToday = forecast ? forecast.safeDailyMinor - (isToday ? spent : 0) : null;

  const catchup = useCatchup();
  const [catchupOpen, setCatchupOpen] = useState(false);
  const toast = useUi((s) => s.toast);
  const inCatchup = !!catchup.from && day >= catchup.from && day <= today;
  const [catchupDays, setCatchupDays] = useState(0);
  const settingsLoaded = useSettings().isSuccess;
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !settingsLoaded) return;
    resumed.current = true;
    if (catchup.from) setDay(daysBetween(catchup.from, today).find((d) => !done.has(d)) ?? today);
  }, [settingsLoaded, catchup.from, done, today]);

  async function finish() {
    const next = Array.from(new Set([...done, day])).sort().slice(-1500);
    await planning.setSetting("daily_done", JSON.stringify(next)).catch(() => {});
    await qc.invalidateQueries({ queryKey: ["settings"] });
    if (inCatchup && catchup.from) {
      const nextOpen = daysBetween(catchup.from, today).find((d) => d > day && !next.includes(d));
      if (nextOpen) {
        toast(t("catchup.dayDone", { date: formatDay(day, { day: "numeric", month: "long" }) }));
        setDay(nextOpen);
        document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const remaining = daysBetween(catchup.from, today).find((d) => !next.includes(d));
      if (remaining) {
        setDay(remaining);
        return;
      }
      setCatchupDays(daysBetween(catchup.from, today).length);
      catchup.stop();
    } else {
      setCatchupDays(0);
    }
    setFinished(true);
  }

  function startCatchup(from: string) {
    catchup.start(from);
    setCatchupOpen(false);
    setFinished(false);
    setDay(daysBetween(from, today).find((d) => !done.has(d)) ?? from);
  }

  const shift = (n: number) => {
    setFinished(false);
    setDay(isoDate(addDays(parseISO(day), n)));
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label={t("date.prev")} onClick={() => shift(-1)}>
            <ChevronLeft className="size-5" />
          </Button>
          <div className="min-w-0 px-1 text-center">
            <div className="text-[12px] font-medium text-muted">{isToday ? t("today.title") : t("today.otherDay")}</div>
            <h1 className="text-xl font-semibold tracking-tight">
              {formatDay(day, { weekday: "long", day: "numeric", month: "long" })}
            </h1>
          </div>
          <Button size="icon" variant="ghost" aria-label={t("date.next")} disabled={isToday} onClick={() => shift(1)}>
            <ChevronRight className="size-5" />
          </Button>
          {!isToday && (
            <Button size="sm" variant="ghost" onClick={() => setDay(today)}>
              {t("common.today")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!catchup.from && (
            <Button size="sm" variant="ghost" onClick={() => setCatchupOpen(true)}>
              <History className="size-4" />
              {t("catchup.button")}
            </Button>
          )}
          {done.has(day) && (
            <span className="flex items-center gap-1 rounded-full bg-income/12 px-2.5 py-1 text-[12px] font-medium text-income">
              <Check className="size-3.5" strokeWidth={3} />
              {t("today.recorded")}
            </span>
          )}
          {streak(done) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-warn/15 px-2.5 py-1 text-[12px] font-semibold text-warn">
              <Flame className="size-3.5" />
              {t("today.streak", { count: streak(done) })}
            </span>
          )}
        </div>
      </header>

      {catchup.from && (
        <CatchupBanner
          from={catchup.from}
          day={day}
          done={done}
          onStop={catchup.stop}
          onResume={() => setDay(daysBetween(catchup.from!, today).find((d) => !done.has(d)) ?? today)}
        />
      )}

      <WeekStrip
        day={day}
        done={done}
        onPick={(d) => {
          setFinished(false);
          setDay(d);
        }}
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("today.spent")}>
          <Money minor={spent} currency={currency} />
        </Stat>
        <Stat label={t("today.earned")}>
          <Money minor={earned} currency={currency} className={earned ? "text-income" : undefined} />
        </Stat>
        <Stat label={isToday ? t("today.leftToday") : t("today.balance")}>
          {isToday && leftToday !== null ? (
            <Money minor={leftToday} currency={currency} tone="auto" className={leftToday >= 0 ? "text-accent" : undefined} />
          ) : (
            <Money minor={earned - spent} currency={currency} signed tone="auto" />
          )}
        </Stat>
      </div>

      <IncomeCheck entries={entries} />
      <QuickAdd day={day} onAdded={() => setFinished(false)} />
      <DayReceipts day={day} entries={entries} />
      <DayList entries={entries} />

      <div className="flex flex-col items-center gap-2 pt-2 pb-6">
        <Button variant="primary" className="h-11 px-6 text-[14px]" onClick={finish}>
          <Check className="size-4" strokeWidth={3} />
          {inCatchup && !isToday ? t("catchup.next") : isToday ? t("today.finish") : t("today.finishDay")}
          {inCatchup && !isToday && <ChevronRight className="size-4" />}
        </Button>
        <span className="text-[12px] text-muted">{inCatchup && !isToday ? t("catchup.nextHint") : t("today.finishHint")}</span>
      </div>

      {finished && (
        <DoneOverlay
          count={entries.length}
          spent={spent}
          currency={currency}
          streakCount={streak(new Set([...done, day]))}
          catchupDays={catchupDays}
          onClose={() => setFinished(false)}
          onPrev={() => shift(-1)}
        />
      )}

      <CatchupStart open={catchupOpen} onOpenChange={setCatchupOpen} onStart={startCatchup} />
    </div>
  );
}

function WeekStrip({ day, done, onPick }: { day: string; done: Set<string>; onPick: (d: string) => void }) {
  const { t } = useTranslation();
  const privacy = usePrefs((s) => s.privacy);
  const today = isoDate();
  const endIso = isoDate(addDays(parseISO(day), 3));
  const end = endIso > today ? today : endIso;
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(parseISO(end), i - 6)));
  const txs = useTransactions({ from: days[0], to: end, limit: 1000 }).data ?? [];
  const spentBy = new Map<string, number>();
  let currency = "EUR";
  for (const tx of txs) {
    currency = tx.currency;
    if (tx.kind === "expense") spentBy.set(tx.occurredOn, (spentBy.get(tx.occurredOn) ?? 0) + tx.amountMinor);
  }
  const max = Math.max(1, ...spentBy.values());
  const fmt = new Intl.NumberFormat(activeLocale(), { style: "currency", currency, maximumFractionDigits: 0 });
  const bare = new Intl.NumberFormat(activeLocale(), { maximumFractionDigits: 0, useGrouping: false });
  return (
    <div role="tablist" aria-label={t("today.week")} className="grid grid-cols-7 gap-1.5">
      {days.map((d) => {
        const spent = spentBy.get(d) ?? 0;
        const active = d === day;
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onPick(d)}
            className={cn(
              "relative flex flex-col items-center gap-0.5 overflow-hidden rounded-xl border px-1 pt-1.5 pb-2 transition-colors",
              active ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-muted/40",
            )}
          >
            <span className={cn("text-[10.5px] font-medium uppercase", active ? "text-accent" : "text-muted")}>
              {formatDay(d, { weekday: "short" }).replace(".", "")}
            </span>
            <span className="text-[15px] leading-tight font-semibold tabular-nums">{Number(d.slice(8))}</span>
            <span className="h-3.5 max-w-full truncate text-[10.5px] text-muted tabular-nums">
              {spent > 0 ? (
                privacy ? (
                  "•••"
                ) : (
                  <>
                    <span className="sm:hidden">{bare.format(spent / 10 ** minorDigits(currency))}</span>
                    <span className="hidden sm:inline">{fmt.format(spent / 10 ** minorDigits(currency))}</span>
                  </>
                )
              ) : d === today ? (
                ""
              ) : (
                "–"
              )}
            </span>
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-expense/50"
              style={{ transform: `scaleX(${spent / max})` }}
            />
            {done.has(d) && (
              <span className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-income text-white">
                <Check className="size-2.5" strokeWidth={3.5} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0 px-3 py-3 sm:px-4">
      <div className="truncate text-[12px] font-medium text-muted">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold tracking-tight whitespace-nowrap sm:text-[20px]">{children}</div>
    </Card>
  );
}

function useTopCategories(kind: TxKind): Category[] {
  const categories = useCategories().data ?? [];
  const recent = useTransactions({ limit: 400 }).data ?? [];
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of recent) if (tx.categoryId && tx.kind === kind) counts.set(tx.categoryId, (counts.get(tx.categoryId) ?? 0) + 1);
    const fit = categories.filter((c) => c.kind === kind || c.kind === "both");
    return [...fit].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)).slice(0, 7);
  }, [categories, recent, kind]);
}

interface Habit {
  kind: TxKind;
  title: string;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  accountId: string;
}

function useHabits(): Habit[] {
  const recent = useTransactions({ limit: 400 }).data ?? [];
  return useMemo(() => {
    const since = isoDate(addDays(new Date(), -60));
    const groups = new Map<string, { habit: Habit; count: number; last: string }>();
    for (const tx of recent) {
      if ((tx.kind !== "expense" && tx.kind !== "income") || !tx.title.trim() || tx.occurredOn < since) continue;
      if (tx.recurringRuleId || tx.debtId || tx.goalId) continue;
      const key = `${tx.kind}|${tx.title.trim().toLowerCase()}|${tx.amountMinor}`;
      const g = groups.get(key);
      if (g) {
        g.count++;
        if (tx.occurredOn > g.last) g.last = tx.occurredOn;
      } else {
        groups.set(key, {
          habit: {
            kind: tx.kind,
            title: tx.title.trim(),
            amountMinor: tx.amountMinor,
            currency: tx.currency,
            categoryId: tx.categoryId,
            accountId: tx.accountId,
          },
          count: 1,
          last: tx.occurredOn,
        });
      }
    }
    return [...groups.values()]
      .filter((g) => g.count >= 2)
      .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
      .slice(0, 6)
      .map((g) => g.habit);
  }, [recent]);
}

function QuickAdd({ day, onAdded }: { day: string; onAdded: () => void }) {
  const { t } = useTranslation();
  const accounts = useAccounts().data ?? [];
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const [kind, setKind] = useState<TxKind>("expense");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(() => {
    try {
      return localStorage.getItem(LAST_ACCOUNT) ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [repeatAs, setRepeatAs] = useState<RepeatPreset>("once");
  const amountRef = useRef<HTMLDivElement>(null);
  const top = useTopCategories(kind);
  const activeAccounts = accounts.filter((a) => !a.archived);
  const account = activeAccounts.find((a) => a.id === accountId) ?? activeAccounts[0];
  const currency = account?.currency ?? "EUR";

  useEffect(() => {
    if (!accountId && account) setAccountId(account.id);
  }, [account, accountId]);

  const habits = useHabits();
  const focusAmount = () => {
    if (os !== "mobile") amountRef.current?.querySelector("input")?.focus({ preventScroll: true });
  };
  useEffect(() => {
    focusAmount();
  }, [day]);

  async function repeat(h: Habit) {
    try {
      await api.createTransaction({
        kind: h.kind,
        amountMinor: h.amountMinor,
        occurredOn: day,
        accountId: accounts.some((a) => a.id === h.accountId && !a.archived) ? h.accountId : (account?.id ?? h.accountId),
        categoryId: h.categoryId,
        counterparty: null,
        title: h.title,
      });
      await invalidateData(qc);
      toast(t("today.repeated", { title: h.title }));
      onAdded();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    let minor = parseMoney(amount, currency);
    let finalKind = kind;
    let finalTitle = title.trim();
    if (minor === null && finalTitle) {
      const parsed = await api.parseQuickEntry(finalTitle).catch(() => null);
      if (parsed?.amountMinor) {
        minor = parsed.amountMinor;
        finalKind = parsed.kind;
        finalTitle = parsed.title;
      }
    }
    if (minor === null || !account) {
      setInvalid(true);
      focusAmount();
      return;
    }
    setBusy(true);
    try {
      let cat = categoryId;
      if (!cat && finalTitle) cat = await receipts.suggestCategory(finalTitle).catch(() => null);
      const preset = REPEAT_PRESETS.find((p) => p.value === repeatAs);
      if (preset?.freq) {
        await planning.upsertRecurring({
          title: finalTitle || t(`kind.${finalKind}`),
          kind: finalKind,
          amountMinor: minor,
          accountId: account.id,
          categoryId: cat,
          freq: preset.freq,
          intervalN: preset.interval,
          startOn: day,
          autoPost: true,
          backfill: true,
        });
        toast(t("today.repeatCreated", { cadence: t(`today.repeatOptions.${preset.value}`) }));
      } else {
        await api.createTransaction({
          kind: finalKind,
          amountMinor: minor,
          occurredOn: day,
          accountId: account.id,
          categoryId: cat,
          counterparty: null,
          title: finalTitle,
        });
      }
      setRepeatAs("once");
      try {
        localStorage.setItem(LAST_ACCOUNT, account.id);
      } catch {
        void 0;
      }
      setAmount("");
      setTitle("");
      setCategoryId(null);
      setInvalid(false);
      await invalidateData(qc);
      onAdded();
      focusAmount();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-stretch gap-2">
          <div role="radiogroup" aria-label={t("tx.new")} className="flex rounded-xl bg-surface-2 p-1">
            {(["expense", "income"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                aria-label={t(`kind.${k}`)}
                onClick={() => {
                  setKind(k);
                  setCategoryId(null);
                  focusAmount();
                }}
                className={cn(
                  "flex w-12 items-center justify-center rounded-lg transition-colors",
                  kind === k ? (k === "expense" ? "bg-expense text-white" : "bg-income text-white") : "text-muted hover:text-fg",
                )}
              >
                {k === "expense" ? <Minus className="size-5" strokeWidth={2.5} /> : <Plus className="size-5" strokeWidth={2.5} />}
              </button>
            ))}
          </div>
          <div ref={amountRef} className="min-w-0 flex-[1_1_8rem] sm:w-40 sm:flex-none">
            <MoneyInput
              value={amount}
              onChange={(v) => {
                setAmount(v);
                setInvalid(false);
              }}
              currency={currency}
              invalid={invalid}
              className="h-12 text-xl font-semibold"
            />
          </div>
          <div className="min-w-0 flex-[1_1_12rem] [&_input]:h-12 [&_input]:text-[15px]">
            <CounterpartyInput value={title} onChange={setTitle} placeholder={t("today.whatFor")} />
          </div>
          <Button type="submit" variant="primary" disabled={busy} className="h-12 px-5">
            <Plus className="size-4" />
            {t("today.add")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {top.map((c) => {
            const active = categoryId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(active ? null : c.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-[12px] font-medium transition-colors",
                  active ? "border-accent bg-accent-soft text-fg" : "border-border text-muted hover:border-muted/40 hover:text-fg",
                )}
              >
                <CategoryIcon category={c} className="size-5 rounded-full [&_svg]:size-3" />
                {displayName(c)}
              </button>
            );
          })}
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <div className="min-w-0 flex-1 sm:w-60 sm:flex-none">
              <AccountSelect value={account?.id ?? ""} onChange={setAccountId} />
            </div>
            <Select
              aria-label={t("today.repeat")}
              value={repeatAs}
              onValueChange={(v) => setRepeatAs(v as RepeatPreset)}
              className={cn("w-40 shrink-0 sm:w-44", repeatAs !== "once" && "border-accent text-accent")}
              items={REPEAT_PRESETS.map((p) => ({
                value: p.value,
                label: t(`today.repeatOptions.${p.value}`),
                icon: <Repeat className={cn("size-3.5", p.value === "once" ? "text-muted/50" : "text-accent")} />,
              }))}
            />
          </div>
        </div>
        {habits.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{t("today.again")}</span>
            <div className="flex flex-wrap gap-1.5">
              {habits.map((h) => (
                <button
                  key={`${h.kind}${h.title}${h.amountMinor}`}
                  type="button"
                  onClick={() => repeat(h)}
                  className="group flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 py-1.5 pr-2.5 pl-2 text-[12.5px] transition-colors hover:border-accent/50 hover:bg-accent-soft"
                >
                  <Plus className="size-3.5 text-muted group-hover:text-accent" strokeWidth={2.5} />
                  <span className="max-w-40 truncate font-medium">{h.title}</span>
                  <Money
                    minor={h.kind === "income" ? h.amountMinor : -h.amountMinor}
                    currency={h.currency}
                    signed={h.kind === "income"}
                    className={cn("text-[12px]", h.kind === "income" ? "text-income" : "text-muted")}
                  />
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[12px] text-muted">{t("today.hint")}</p>
      </form>
    </Card>
  );
}

function DayReceipts({ day, entries }: { day: string; entries: Transaction[] }) {
  const { t } = useTranslation();
  const inbox = useAttachments({ inbox: true }).data ?? [];
  const importFiles = useReceiptImport();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <ScanLine className="size-3.5" />
          {t("today.receipts")}
        </h2>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => camRef.current?.click()}>
            <Camera className="size-3.5" />
            {t("receipts.takePhoto")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
            <FolderOpen className="size-3.5" />
            {t("receipts.chooseFiles")}
          </Button>
        </div>
      </div>
      <input ref={camRef} type="file" accept={IMAGE_ACCEPT} capture="environment" hidden onChange={(e) => { if (e.target.files) importFiles(e.target.files, { review: false }); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) importFiles(e.target.files, { review: false }); e.target.value = ""; }} />
      {inbox.length === 0 ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
          className={cn(
            "mx-4 mb-4 flex flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
            over ? "border-accent bg-accent-soft/50" : "border-border",
          )}
        >
          <Paperclip className="size-5 text-muted" />
          <span className="text-[13px] font-medium">{day === isoDate() ? t("today.dropTitle") : t("today.dropTitleDay", { date: formatDay(day, { weekday: "long", day: "numeric", month: "long" }) })}</span>
          <span className="text-[12px] text-muted">{t("today.dropHint")}</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 px-4 pb-4">
          {inbox.map((a) => (
            <ReceiptRow key={a.id} attachment={a} day={day} entries={entries} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReceiptRow({ attachment: a, day, entries }: { attachment: Attachment; day: string; entries: Transaction[] }) {
  const { t } = useTranslation();
  const accounts = useAccounts().data ?? [];
  const openReceipt = useUi((s) => s.openReceipt);
  const ex = a.extracted;
  const account = (() => {
    try {
      const id = localStorage.getItem(LAST_ACCOUNT);
      return accounts.find((x) => x.id === id && !x.archived) ?? accounts.find((x) => !x.archived);
    } catch {
      return accounts.find((x) => !x.archived);
    }
  })();
  const book = useAppMutation(
    async () => {
      const title = ex?.merchant ?? t("receipts.receipt");
      const cat = await receipts.suggestCategory(title).catch(() => null);
      const tx = await api.createTransaction({
        kind: "expense",
        amountMinor: ex!.totalMinor!,
        occurredOn: day,
        accountId: account!.id,
        categoryId: cat,
        counterparty: ex?.merchant ?? null,
        title,
      });
      await receipts.link(a.id, tx.id);
    },
    { success: t("receipts.booked") },
  );
  const link = useAppMutation((txId: string) => receipts.link(a.id, txId), { success: t("receipts.linked") });
  const del = useAppMutation(() => receipts.delete(a.id), { success: t("common.deleted") });
  const linkable = entries.filter((e) => e.kind === "expense" && e.attachmentCount === 0);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-2.5">
      <ReceiptThumb attachment={a} className="size-14 shrink-0 cursor-zoom-in" onClick={() => openReceipt(a)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{ex?.merchant ?? t("receipts.unknownMerchant")}</div>
        <div className="text-[12px] text-muted">
          {ex?.totalMinor ? <Money minor={ex.totalMinor} currency={ex.currency ?? "EUR"} className="font-semibold text-fg" /> : t("today.noAmount")}
          {ex?.date && ex.date !== day && <span> · {t("today.receiptDate", { date: formatDay(ex.date) })}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {ex?.totalMinor && account ? (
          <Button size="sm" variant="primary" disabled={book.isPending} onClick={() => book.mutate(undefined)}>
            <Check className="size-3.5" />
            {t("today.bookReceipt")}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => openReceipt(a)}>
            {t("today.checkReceipt")}
          </Button>
        )}
        {linkable.length > 0 && (
          <div className="w-44">
            <Select
              aria-label={t("today.linkTo")}
              value=""
              placeholder={t("today.linkTo")}
              onValueChange={(v) => v && link.mutate(v)}
              items={linkable.map((e) => ({
                value: e.id,
                label: (
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate">{e.title || e.counterpartyName || "—"}</span>
                    <Money minor={e.amountMinor} currency={e.currency} className="text-muted" />
                  </span>
                ),
                text: e.title || e.counterpartyName || "—",
                icon: <Link2 className="size-3.5 text-muted" />,
              }))}
              triggerClassName="h-8 text-[13px]"
            />
          </div>
        )}
        <Button size="icon" variant="ghost" className="size-8" aria-label={t("common.delete")} onClick={() => del.mutate(undefined)}>
          <X className="size-4" />
        </Button>
      </div>
    </li>
  );
}

function DayList({ entries }: { entries: Transaction[] }) {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const openEdit = useUi((s) => s.openEditTx);
  const del = useDeleteTransaction();
  if (entries.length === 0) {
    return (
      <Card className="px-4 py-8 text-center text-[13px] text-muted">
        {t("today.empty")}
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 text-[13px] font-semibold text-muted">{t("today.entries", { count: entries.length })}</div>
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li key={e.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
            <button type="button" onClick={() => openEdit(e)} className="flex min-w-0 flex-1 items-center gap-3 text-left active:scale-100">
              <CategoryIcon category={categories.find((c) => c.id === e.categoryId)} kind={e.kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {e.title || e.counterpartyName || t("tx.untitled")}
                  {e.recurringRuleId && <Repeat aria-label={t("today.recurringBadge")} className="ml-1.5 inline size-3 text-accent" />}
                  {e.attachmentCount > 0 && <Paperclip className="ml-1.5 inline size-3 text-muted" />}
                </span>
                <span className="block truncate text-[12px] text-muted">
                  {e.kind === "transfer"
                    ? t("kind.transfer")
                    : categories.find((c) => c.id === e.categoryId)
                      ? displayName(categories.find((c) => c.id === e.categoryId)!)
                      : t("category.uncategorized")}
                </span>
              </span>
              <Money
                minor={e.kind === "transfer" ? e.amountMinor : signed(e)}
                currency={e.currency}
                signed={e.kind === "income"}
                className={cn("font-semibold", e.kind === "income" && "text-income", e.kind === "transfer" && "text-muted")}
              />
            </button>
            <button
              type="button"
              aria-label={t("common.delete")}
              onClick={() => del.mutate(e.id)}
              className="rounded-md p-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-expense/10 hover:text-expense focus-visible:opacity-100"
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DoneOverlay({
  count,
  spent,
  currency,
  streakCount,
  catchupDays,
  onClose,
  onPrev,
}: {
  count: number;
  spent: number;
  currency: string;
  streakCount: number;
  catchupDays: number;
  onClose: () => void;
  onPrev: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSimple = usePrefs((s) => s.set);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-bg/70 p-4 pt-[14vh] backdrop-blur-md animate-[fade-in_200ms_ease-out]">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-surface text-center shadow-[0_32px_80px_-20px_rgb(0_0_0/0.4)] animate-[dialog-in_280ms_var(--ease-out)]">
        <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-6">
          <span className="flex size-16 items-center justify-center rounded-full bg-income/15 text-income animate-[pop-in_400ms_var(--ease-out)]">
            <Check className="size-8" strokeWidth={3} />
          </span>
          <h2 className="text-xl font-semibold tracking-tight">{catchupDays ? t("catchup.doneTitle") : t("today.doneTitle")}</h2>
          {catchupDays ? (
            <p className="text-[13px] text-muted">{t("catchup.doneText", { count: catchupDays })}</p>
          ) : (
            <p className="text-[13px] text-muted">
              {t("today.doneText", { count })}{" "}
              <Money minor={spent} currency={currency} className="font-semibold text-fg" />
            </p>
          )}
          {streakCount > 1 && (
            <span className="flex items-center gap-1 rounded-full bg-warn/15 px-3 py-1 text-[12px] font-semibold text-warn">
              <Flame className="size-3.5" />
              {t("today.streak", { count: streakCount })}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-border p-4">
          {isTauri && os !== "mobile" && (
            <Button
              variant="primary"
              className="h-10 justify-center"
              onClick={() => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow().close())}
            >
              {t("today.closeApp")}
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button className="justify-center" onClick={onPrev}>
              <ChevronLeft className="size-4" />
              {t("today.previousDay")}
            </Button>
            <Button
              className="justify-center"
              onClick={() => {
                setSimple("simpleMode", false);
                navigate({ to: "/" });
              }}
            >
              <LayoutDashboard className="size-4" />
              {t("today.fullView")}
            </Button>
          </div>
          <Button variant="ghost" className="justify-center" onClick={onClose}>
            {t("today.keepGoing")}
          </Button>
        </div>
      </div>
    </div>
  );
}
