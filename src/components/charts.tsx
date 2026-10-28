import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastDay, MonthTotals, Occurrence } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import { monthLabel, shortDate } from "@/lib/format";
import { activeLocale } from "@/lib/i18n";
import { formatMoney, joinParts, minorDigits } from "@/lib/money";
import { Money } from "@/components/ui/extra";
import { cn } from "@/lib/cn";

const axisTick = { fill: "var(--muted)", fontSize: 11 };

function compactMoney(minor: number, currency: string) {
  const f = new Intl.NumberFormat(activeLocale(), {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const value = minor / 10 ** minorDigits(currency);
  return joinParts(f.formatToParts(value));
}

function TooltipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-40 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-xl">
      {children}
    </div>
  );
}

export function ForecastChart({
  days,
  events,
  currency,
  height = 220,
  minOn,
  compact,
}: {
  days: ForecastDay[];
  events: Occurrence[];
  currency: string;
  height?: number | string;
  minOn?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const byDay = new Map<string, Occurrence[]>();
  for (const e of events) {
    const d = days[0] && e.date < days[0].date ? days[0].date : e.date;
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  const data = days.map((d) => ({ ...d, balance: d.balanceMinor }));
  const min = data.reduce((m, d) => Math.min(m, d.balance), Infinity);
  const max = data.reduce((m, d) => Math.max(m, d.balance), -Infinity);
  const minPoint = minOn ? data.find((d) => d.date === minOn) : undefined;

  const pad = Math.max((max - min) * 0.25, Math.abs(max) * 0.05, 100);
  const domain: [number, number] | undefined = compact ? [Math.min(min - pad, min < 0 ? min : Infinity), max + pad] : undefined;

  const zeroAt = max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: compact ? 4 : 0 }}>
          <defs>
            <linearGradient id="fc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset={`${zeroAt * 100}%`} stopColor="var(--accent)" stopOpacity={0.04} />
              <stop offset={`${zeroAt * 100}%`} stopColor="var(--expense)" stopOpacity={0.08} />
              <stop offset="100%" stopColor="var(--expense)" stopOpacity={0.25} />
            </linearGradient>
            <linearGradient id="fc-stroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={`${zeroAt * 100}%`} stopColor="var(--accent)" />
              <stop offset={`${zeroAt * 100}%`} stopColor="var(--expense)" />
            </linearGradient>
          </defs>
          {!compact && <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />}
          <XAxis
            dataKey="date"
            hide={compact}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            tickFormatter={(d: string) => shortDate(d)}
          />
          <YAxis
            hide={compact}
            width={64}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => compactMoney(v, currency)}
            domain={domain ?? [(lo: number) => Math.min(0, lo), "auto"]}
          />
          {min < 0 && <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="4 4" strokeOpacity={0.6} />}
          <Tooltip
            cursor={{ stroke: "var(--muted)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as ForecastDay;
              const evs = byDay.get(d.date) ?? [];
              return (
                <TooltipBox>
                  <div className="text-muted">{formatDay(d.date, { weekday: "short", day: "numeric", month: "long" })}</div>
                  <div className="mt-0.5 text-[14px] font-semibold">
                    <Money minor={d.balanceMinor} currency={currency} tone="auto" />
                  </div>
                  {evs.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-border pt-1.5">
                      {evs.slice(0, 5).map((e) => (
                        <li key={e.ruleId} className="flex justify-between gap-3">
                          <span className="truncate">{e.title}</span>
                          <Money
                            flow
                            minor={e.kind === "income" ? e.amountMinor : -e.amountMinor}
                            currency={e.currency}
                            signed
                            className={e.kind === "income" ? "text-income" : undefined}
                          />
                        </li>
                      ))}
                      {evs.length > 5 && <li className="text-muted">+{evs.length - 5}</li>}
                    </ul>
                  )}
                </TooltipBox>
              );
            }}
          />
          <Area
            type="stepAfter"
            dataKey="balance"
            stroke={min < 0 ? "url(#fc-stroke)" : "var(--accent)"}
            strokeWidth={2}
            fill="url(#fc-fill)"
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
          />
          {minPoint && min < max && (
            <ReferenceDot
              x={minPoint.date}
              y={minPoint.balance}
              r={4}
              fill={minPoint.balance < 0 ? "var(--expense)" : "var(--accent)"}
              stroke="var(--surface)"
              strokeWidth={2}
              label={
                compact
                  ? undefined
                  : {
                      value: `${t("forecast.lowest")} ${formatMoney(minPoint.balance, currency, activeLocale())}`,
                      position: "bottom",
                      fill: "var(--muted)",
                      fontSize: 11,
                    }
              }
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CashflowChart({ data, currency, height = 220 }: { data: MonthTotals[]; currency: string; height?: number }) {
  const { t } = useTranslation();
  if (!data.some((m) => m.incomeMinor || m.expenseMinor)) {
    return (
      <div style={{ height: height + 28 }} className="flex flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-16 items-end gap-1.5 opacity-60" aria-hidden>
          {[34, 52, 28, 64, 44, 58].map((v, i) => (
            <span key={i} className="w-3 rounded-t-[4px] bg-surface-2" style={{ height: `${v}%` }} />
          ))}
        </div>
        <p className="max-w-xs text-[13px] text-muted">{t("dashboard.cashflowEmpty")}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-4 text-[12px] text-muted" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: "var(--chart-in)" }} />
          {t("dashboard.income")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: "var(--chart-out)" }} />
          {t("dashboard.expenses")}
        </span>
      </div>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              tickFormatter={(m: string) => monthLabel(m, { month: "short" })}
            />
            <YAxis
              width={64}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => compactMoney(v, currency)}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const m = payload[0].payload as MonthTotals;
                return (
                  <TooltipBox>
                    <div className="mb-1 text-muted">{monthLabel(m.month)}</div>
                    <Row color="var(--chart-in)" label={t("dashboard.income")} minor={m.incomeMinor} currency={currency} />
                    <Row color="var(--chart-out)" label={t("dashboard.expenses")} minor={m.expenseMinor} currency={currency} />
                    <div className="mt-1 flex justify-between gap-3 border-t border-border pt-1 font-medium">
                      <span>{t("dashboard.net")}</span>
                      <Money minor={m.incomeMinor - m.expenseMinor} currency={currency} signed tone="auto" />
                    </div>
                  </TooltipBox>
                );
              }}
            />
            <Bar dataKey="incomeMinor" fill="var(--chart-in)" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={22} />
            <Bar dataKey="expenseMinor" fill="var(--chart-out)" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Row({ color, label, minor, currency }: { color: string; label: string; minor: number; currency: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-sm" style={{ background: color }} />
        {label}
      </span>
      <Money minor={minor} currency={currency} />
    </div>
  );
}

export interface LineSeries {
  id: string;
  name: string;
  color: string;
  balances: number[];
}

export function AccountLinesChart({
  dates,
  series,
  currency,
  height = 220,
  compact,
}: {
  dates: string[];
  series: LineSeries[];
  currency: string;
  height?: number | string;
  compact?: boolean;
}) {
  const data = dates.map((date, i) => {
    const row: Record<string, number | string> = { date };
    for (const s of series) row[s.id] = s.balances[i] ?? 0;
    return row;
  });
  const values = series.flatMap((s) => s.balances);
  const min = Math.min(0, ...values);
  return (
    <div className="flex h-full w-full flex-col gap-1.5" style={{ height }}>
      <div className={cn("flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted", compact ? "px-5" : "px-2")}>
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="min-h-0 w-full flex-1">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: compact ? 8 : 4, bottom: 0, left: compact ? 8 : 0 }}>
            {!compact && <CartesianGrid vertical={false} stroke="var(--border)" />}
            <XAxis dataKey="date" hide={compact} tick={axisTick} tickLine={false} axisLine={false} minTickGap={40} tickFormatter={(d: string) => shortDate(d)} />
            <YAxis hide={compact} width={64} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => compactMoney(v, currency)} />
            {min < 0 && <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="4 4" strokeOpacity={0.6} />}
            <Tooltip
              cursor={{ stroke: "var(--muted)", strokeWidth: 1, strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, number | string>;
                return (
                  <TooltipBox>
                    <div className="mb-1 text-muted">{formatDay(String(row.date), { weekday: "short", day: "numeric", month: "long" })}</div>
                    {series.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
                          <span className="truncate">{s.name}</span>
                        </span>
                        <Money minor={Number(row[s.id])} currency={currency} tone="auto" />
                      </div>
                    ))}
                  </TooltipBox>
                );
              }}
            />
            {series.map((s) => (
              <Line
                key={s.id}
                type="stepAfter"
                dataKey={s.id}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--surface)" }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
