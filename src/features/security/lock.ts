import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
import { vault } from "@/lib/api";
import { isTauri } from "@/lib/platform";

export function useVaultStatus() {
  return useQuery({ queryKey: ["vaultStatus"], queryFn: vault.status, enabled: isTauri, staleTime: Infinity });
}

export const useLock = create<{ locked: boolean; lock: () => void; unlock: () => void }>((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}));
