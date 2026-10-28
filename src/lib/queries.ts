import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, isApiError, planning, receipts, sync, type TransactionFilter, type TransactionInput, type TxKind } from "@/lib/api";
import { useUi } from "@/stores/ui";

export const keys = {
  appInfo: ["appInfo"] as const,
  settings: ["settings"] as const,
  accounts: ["accounts"] as const,
  categories: ["categories"] as const,
  counterparties: ["counterparties"] as const,
  transactions: (f?: TransactionFilter) => ["transactions", f ?? {}] as const,
  summary: (from: string, to: string, currency: string) => ["summary", from, to, currency] as const,
};

export const useAppInfo = () => useQuery({ queryKey: keys.appInfo, queryFn: api.appInfo });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: planning.getSettings });
export const useAccounts = () => useQuery({ queryKey: keys.accounts, queryFn: api.listAccounts });
export const useCategories = () =>
  useQuery({ queryKey: keys.categories, queryFn: api.listCategories });
export const useCounterparties = () =>
  useQuery({ queryKey: keys.counterparties, queryFn: api.listCounterparties });

export const useTransactions = (filter?: TransactionFilter) =>
  useQuery({
    queryKey: keys.transactions(filter),
    queryFn: () => api.listTransactions(filter),
    placeholderData: (prev) => prev,
  });

export const useRecentTitles = (kind?: TxKind) =>
  useQuery({ queryKey: ["transactions", "titles", kind ?? "all"], queryFn: () => api.recentTitles(kind), staleTime: 60_000 });

export const useTransactionTotals = (filter?: TransactionFilter) =>
  useQuery({
    queryKey: [...keys.transactions(filter), "totals"],
    queryFn: () => api.transactionTotals(filter),
    placeholderData: (prev) => prev,
  });

export const useSummary = (from: string, to: string, currency: string | undefined) =>
  useQuery({
    queryKey: keys.summary(from, to, currency ?? ""),
    queryFn: () => api.periodSummary(from, to, currency!),
    enabled: !!currency,
  });

export const useRecurring = () => useQuery({ queryKey: ["recurring"], queryFn: planning.listRecurring });
export const useUpcoming = (days: number) =>
  useQuery({ queryKey: ["upcoming", days], queryFn: () => planning.upcoming(days), refetchInterval: 60_000 });
export const useDebts = () => useQuery({ queryKey: ["debts"], queryFn: planning.listDebts });
export const useGoals = () => useQuery({ queryKey: ["goals"], queryFn: planning.listGoals });
export const useGoalAllocations = (goalId: string | undefined) =>
  useQuery({
    queryKey: ["goalAllocations", goalId],
    queryFn: () => planning.goalAllocations(goalId!),
    enabled: !!goalId,
  });
export const useBudgets = () => useQuery({ queryKey: ["budgets"], queryFn: planning.listBudgets });
export const useForecast = (days: number) =>
  useQuery({ queryKey: ["forecast", days], queryFn: () => planning.forecast(days), placeholderData: (p) => p });
export const useMonthPreview = (month: string) =>
  useQuery({ queryKey: ["monthPreview", month], queryFn: () => planning.monthPreview(month), placeholderData: (p) => p });
export const useMonthlySeries = (months: number) =>
  useQuery({ queryKey: ["monthlySeries", months], queryFn: () => planning.monthlySeries(months) });
export const useInsights = () => useQuery({ queryKey: ["insights"], queryFn: planning.insights });

export function useErrorMessage() {
  const { t } = useTranslation();
  return (e: unknown) =>
    !isApiError(e)
      ? t("errors.unknown")
      : e.code === "unreachable"
        ? t("errors.unreachable")
        : e.code === "unsupported"
          ? t(`errors.unsupported_${e.message}`, { defaultValue: t("errors.unknown") })
          : `${t(`errors.${e.code}`)}: ${e.message}`;
}

export function invalidateData(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "attachmentImage" });
}

export function useAppMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string } = {},
) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await invalidateData(qc);
      if (opts.success) toast(opts.success);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

export function useSaveTransaction() {
  return useAppMutation(({ id, input }: { id?: string; input: TransactionInput }) =>
    id ? api.updateTransaction(id, input) : api.createTransaction(input),
  );
}

export function useDeleteTransaction() {
  return useAppMutation((id: string) => api.deleteTransaction(id));
}

export const useAttachments = (filter?: { inbox?: boolean; transactionId?: string }, enabled = true) =>
  useQuery({ queryKey: ["attachments", filter ?? {}], queryFn: () => receipts.list(filter), enabled });

export const useAttachmentImage = (id: string | undefined, thumb = true) =>
  useQuery({
    queryKey: ["attachmentImage", id, thumb],
    queryFn: async () => URL.createObjectURL(new Blob([await receipts.image(id!, thumb)])),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  });

export const useOcrStatus = () => useQuery({ queryKey: ["ocrStatus"], queryFn: receipts.ocrStatus, staleTime: Infinity });

export const useSyncStatus = (poll = false) =>
  useQuery({ queryKey: ["syncStatus"], queryFn: sync.status, refetchInterval: poll ? 2000 : 15_000, retry: false });
