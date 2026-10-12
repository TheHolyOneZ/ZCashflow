import type { RecurringInput, RecurringRule } from "@/lib/api";

export function ruleInput(rule: RecurringRule, patch: Partial<RecurringInput> = {}): RecurringInput {
  return {
    id: rule.id,
    title: rule.title,
    kind: rule.kind,
    amountMinor: rule.amountMinor,
    accountId: rule.accountId,
    toAccountId: rule.toAccountId,
    categoryId: rule.categoryId,
    counterparty: rule.counterpartyName,
    freq: rule.freq,
    intervalN: rule.intervalN,
    startOn: rule.startOn,
    endOn: rule.endOn,
    maxCount: rule.maxCount,
    autoPost: rule.autoPost,
    note: rule.note,
    ...patch,
  };
}

export const REPEAT_PRESETS = [
  { value: "once", freq: null, interval: 0 },
  { value: "weekly", freq: "weekly", interval: 1 },
  { value: "monthly", freq: "monthly", interval: 1 },
  { value: "bimonthly", freq: "monthly", interval: 2 },
  { value: "quarterly", freq: "monthly", interval: 3 },
  { value: "halfyearly", freq: "monthly", interval: 6 },
  { value: "yearly", freq: "yearly", interval: 1 },
] as const;

export type RepeatPreset = (typeof REPEAT_PRESETS)[number]["value"];
