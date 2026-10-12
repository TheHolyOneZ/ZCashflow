import { create } from "zustand";
import type { Attachment, Transaction, TransactionInput } from "@/lib/api";

export type Theme = "system" | "light" | "dark" | "midnight";

const THEME_KEY = "zc.theme";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark" || t === "system" || t === "midnight") return t;
  } catch {
  }
  return "system";
}

const media = window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || theme === "midnight" || (theme === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("midnight", theme === "midnight");
}

export type TxDialogState =
  | { open: false }
  | { open: true; editing: Transaction }
  | { open: true; draft: Partial<TransactionInput> };

export interface Toast {
  id: number;
  message: string;
  tone: "default" | "error";
}

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  txDialog: TxDialogState;
  openNewTx: (draft?: Partial<TransactionInput>) => void;
  openEditTx: (tx: Transaction) => void;
  closeTx: () => void;
  receipt: Attachment | null;
  openReceipt: (a: Attachment | null) => void;

  processing: number;
  setProcessing: (delta: number) => void;
  toasts: Toast[];
  toast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
    }
    applyTheme(theme);
    set({ theme });
  },
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  txDialog: { open: false },
  openNewTx: (draft = {}) => set({ txDialog: { open: true, draft }, paletteOpen: false }),
  openEditTx: (editing) => set({ txDialog: { open: true, editing } }),
  closeTx: () => set({ txDialog: { open: false } }),
  receipt: null,
  openReceipt: (receipt) => set({ receipt, paletteOpen: false }),
  processing: 0,
  setProcessing: (delta) => set({ processing: Math.max(0, get().processing + delta) }),
  toasts: [],
  toast: (message, tone = "default") => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismissToast(id), tone === "error" ? 6000 : 3000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

media.addEventListener("change", () => applyTheme(useUi.getState().theme));
applyTheme(useUi.getState().theme);
