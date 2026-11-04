import { create } from "zustand";

export type Span = "month" | "year";
export type Tab = "expense" | "income";

interface StatsView {
  span: Span;
  at: Date;
  tab: Tab;
  picked: string | null;
  expanded: string[];
  update: (patch: Partial<Omit<StatsView, "update">>) => void;
}

export const useStatsView = create<StatsView>((set) => ({
  span: "month",
  at: new Date(),
  tab: "expense",
  picked: null,
  expanded: [],
  update: (patch) => set(patch),
}));
