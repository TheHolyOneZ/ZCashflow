import { create } from "zustand";
import { os } from "@/lib/platform";

export const ACCENTS = {
  teal: { light: "#0f766e", dark: "#2dd4bf" },
  blue: { light: "#2563eb", dark: "#60a5fa" },
  indigo: { light: "#4f46e5", dark: "#818cf8" },
  violet: { light: "#7c3aed", dark: "#a78bfa" },
  rose: { light: "#e11d48", dark: "#fb7185" },
  orange: { light: "#ea580c", dark: "#fb923c" },
  amber: { light: "#b45309", dark: "#fbbf24" },
  green: { light: "#15803d", dark: "#4ade80" },
  graphite: { light: "#27272a", dark: "#e4e4e7" },
} as const;

export type Accent = keyof typeof ACCENTS;
export type Density = "compact" | "comfortable" | "spacious";
export type Radius = "sharp" | "soft" | "round";
export type FontChoice = "inter" | "geist" | "manrope" | "system";
export type Motion = "system" | "full" | "reduced";
export type TitleBar = "custom" | "system";
export type StartPage = "/" | "/transactions" | "/planner" | "/receipts";

export const DASHBOARD_WIDGETS = [
  "hero",
  "insights",
  "stats",
  "cashflow",
  "upcoming",
  "recent",
  "accounts",
  "budgets",
  "goals",
] as const;
export type DashboardWidget = (typeof DASHBOARD_WIDGETS)[number];

const VERSION = 2;

export interface Prefs {
  v: number;
  accent: Accent;
  density: Density;
  radius: Radius;
  font: FontChoice;
  scale: number;
  motion: Motion;
  titleBar: TitleBar;
  sidebarCollapsed: boolean;
  simpleMode: boolean;
  privacy: boolean;
  revealOnHover: boolean;
  startPage: StartPage;
  hiddenWidgets: DashboardWidget[];
}

export const DEFAULT_PREFS: Prefs = {
  v: VERSION,
  accent: "teal",
  density: "comfortable",
  radius: "soft",
  font: "inter",
  scale: 1,
  motion: "system",
  titleBar: "custom",
  sidebarCollapsed: false,
  simpleMode: false,
  privacy: false,
  revealOnHover: true,
  startPage: "/",
  hiddenWidgets: [],
};

const KEY = "zc.prefs";

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      const merged: Prefs = { ...DEFAULT_PREFS, ...stored };
      if ((stored.v ?? 1) < 2) merged.titleBar = "custom";
      merged.v = VERSION;
      return merged;
    }
  } catch {
    return DEFAULT_PREFS;
  }
  return DEFAULT_PREFS;
}

function save(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    return;
  }
}

export function applyPrefs(p: Prefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.accent = p.accent;
  root.dataset.density = p.density;
  root.dataset.radius = p.radius;
  root.dataset.font = p.font;
  root.dataset.privacy = p.privacy ? (p.revealOnHover ? "hover" : "on") : "off";
  root.dataset.motion = p.motion;
  root.dataset.os = os;
  root.style.setProperty("--accent-light", ACCENTS[p.accent].light);
  root.style.setProperty("--accent-dark", ACCENTS[p.accent].dark);
  root.style.zoom = p.scale === 1 ? "" : String(p.scale);
}

interface PrefsState extends Prefs {
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  toggle: (key: "sidebarCollapsed" | "privacy" | "simpleMode") => void;
  toggleWidget: (w: DashboardWidget) => void;
  reset: () => void;
}

export const usePrefs = create<PrefsState>((setState, get) => {
  const commit = (patch: Partial<Prefs>) => {
    const { set: _s, toggle: _t, toggleWidget: _w, reset: _r, ...current } = get();
    const next = { ...current, ...patch };
    save(next);
    applyPrefs(next);
    setState(patch);
  };
  return {
    ...load(),
    set: (key, value) => commit({ [key]: value } as Partial<Prefs>),
    toggle: (key) => commit({ [key]: !get()[key] }),
    toggleWidget: (w) => {
      const hidden = get().hiddenWidgets;
      commit({ hiddenWidgets: hidden.includes(w) ? hidden.filter((x) => x !== w) : [...hidden, w] });
    },
    reset: () => commit({ ...DEFAULT_PREFS }),
  };
});

applyPrefs(usePrefs.getState());
