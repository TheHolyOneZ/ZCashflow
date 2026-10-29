import { isoDate } from "@/lib/dates";
import { isAndroid } from "@/lib/platform";
import { invoke } from "@tauri-apps/api/core";

export type TxKind = "income" | "expense" | "transfer";
export type AccountKind = "cash" | "checking" | "savings" | "credit" | "other";
export type CategoryKind = "income" | "expense" | "both";

export interface AppInfo {
  version: string;
  deviceId: string;
  defaultCurrency: string;
  mainCurrency: string;
}

export interface Account {
  id: string;
  name: string;
  systemKey: string | null;
  kind: AccountKind;
  currency: string;
  openingMinor: number;
  balanceMinor: number;
  color: string | null;
  archived: boolean;
  anchorOn: string | null;
}

export interface AccountInput {
  id?: string;
  name: string;
  kind: AccountKind;
  currency: string;
  openingMinor: number;
  color?: string | null;
  archived?: boolean;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  systemKey: string | null;
  kind: CategoryKind;
  icon: string | null;
  color: string | null;
}

export interface CategoryInput {
  id?: string;
  parentId?: string | null;
  name: string;
  kind: CategoryKind;
  icon?: string | null;
  color?: string | null;
}

export interface Counterparty {
  id: string;
  name: string;
  kind: string;
}

export interface Transaction {
  id: string;
  ref: string;
  kind: TxKind;
  amountMinor: number;
  currency: string;
  occurredOn: string;
  occurredTime: string | null;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  title: string;
  note: string | null;
  tags: string[];
  recurringRuleId: string | null;
  debtId: string | null;
  goalId: string | null;
  createdAt: string;
  attachmentCount: number;
}

export interface TransactionInput {
  kind: TxKind;
  amountMinor: number;
  currency?: string | null;
  occurredOn: string;
  occurredTime?: string | null;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  counterparty?: string | null;
  title: string;
  note?: string | null;
  tags?: string[];
  debtId?: string | null;
  goalId?: string | null;
}

export interface TransactionFilter {
  from?: string;
  to?: string;
  kind?: TxKind;
  accountId?: string;
  categoryId?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface CurrencyTotal {
  currency: string;
  count: number;
  incomeMinor: number;
  expenseMinor: number;
  openingMinor: number | null;
  closingMinor: number | null;
}

export interface DayTotal {
  date: string;
  currency: string;
  incomeMinor: number;
  expenseMinor: number;
}

export interface TransactionTotals {
  count: number;
  currencies: CurrencyTotal[];
  days: DayTotal[];
}

export interface QuickEntry {
  title: string;
  amountMinor: number | null;
  kind: "income" | "expense";
  occurredOn: string;
}

export interface PeriodSummary {
  from: string;
  to: string;
  currency: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  expenseByCategory: { categoryId: string | null; totalMinor: number }[];
}

export interface ApiError {
  code: "db" | "io" | "not_found" | "invalid" | "unreachable" | "unsupported";
  message: string;
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  setDefaultCurrency: (currency: string) => invoke<void>("set_default_currency", { currency }),
  relabelCurrency: (from: string, to: string) =>
    invoke<{ accounts: number; rows: number }>("relabel_currency", { from, to }),

  listAccounts: () => invoke<Account[]>("list_accounts"),
  upsertAccount: (input: AccountInput) => invoke<Account>("upsert_account", { input }),
  setAccountBalance: (id: string, balanceMinor: number, today: string = isoDate()) =>
    invoke<Account>("set_account_balance", { id, balanceMinor, today }),

  listCategories: () => invoke<Category[]>("list_categories"),
  upsertCategory: (input: CategoryInput) => invoke<Category>("upsert_category", { input }),
  moveCategory: (id: string, parentId: string | null) => invoke<Category>("move_category", { id, parentId }),

  listCounterparties: () => invoke<Counterparty[]>("list_counterparties"),

  listTransactions: (filter?: TransactionFilter) =>
    invoke<Transaction[]>("list_transactions", { filter }),
  recentTitles: (kind?: TxKind, limit?: number) => invoke<string[]>("recent_titles", { kind, limit }),
  transactionTotals: (filter?: TransactionFilter) =>
    invoke<TransactionTotals>("transaction_totals", { filter }),
  createTransaction: (input: TransactionInput) =>
    invoke<Transaction>("create_transaction", { input }),
  updateTransaction: (id: string, input: TransactionInput) =>
    invoke<Transaction>("update_transaction", { id, input }),
  deleteTransaction: (id: string) => invoke<void>("delete_transaction", { id }),

  parseQuickEntry: (text: string) => invoke<QuickEntry>("parse_quick_entry", { text }),
  periodSummary: (from: string, to: string, currency: string) =>
    invoke<PeriodSummary>("period_summary", { from, to, currency }),
};

export type Freq = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurringRule {
  id: string;
  title: string;
  kind: TxKind;
  amountMinor: number;
  currency: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  freq: Freq;
  intervalN: number;
  startOn: string;
  endOn: string | null;
  maxCount: number | null;
  autoPost: boolean;
  postFrom: string;
  occurredTime: string | null;
  note: string | null;
  debtId: string | null;
  nextOn: string | null;
  monthlyMinor: number;
  postedCount: number;
}

export interface RecurringInput {
  id?: string;
  title: string;
  kind: TxKind;
  amountMinor: number;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  counterparty?: string | null;
  freq: Freq;
  intervalN: number;
  startOn: string;
  endOn?: string | null;
  maxCount?: number | null;
  autoPost: boolean;
  backfill?: boolean;
  occurredTime?: string | null;
  note?: string | null;
}

export interface Occurrence {
  ruleId: string;
  date: string;
  time: string | null;
  title: string;
  kind: TxKind;
  amountMinor: number;
  currency: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  debtId: string | null;
  autoPost: boolean;
  overdue: boolean;
}

export type DebtDirection = "i_owe" | "owed_to_me";

export interface Debt {
  id: string;
  title: string;
  direction: DebtDirection;
  counterpartyId: string | null;
  counterpartyName: string | null;
  principalMinor: number;
  currency: string;
  startOn: string;
  dueOn: string | null;
  interestBp: number | null;
  note: string | null;
  archived: boolean;
  paidMinor: number;
  remainingMinor: number;
  paymentCount: number;
  lastPaymentOn: string | null;
  installment: RecurringRule | null;
  nextPaymentOn: string | null;
  payoffOn: string | null;
}

export interface DebtInput {
  id?: string;
  title: string;
  direction: DebtDirection;
  counterparty?: string | null;
  principalMinor: number;
  currency?: string | null;
  startOn: string;
  dueOn?: string | null;
  interestBp?: number | null;
  note?: string | null;
  archived?: boolean;
  installment?: {
    amountMinor: number;
    freq: Freq;
    intervalN: number;
    startOn: string;
    accountId: string;
    autoPost: boolean;
  } | null;
}

export interface Goal {
  id: string;
  title: string;
  targetMinor: number;
  currency: string;
  targetOn: string | null;
  accountId: string | null;
  color: string | null;
  icon: string | null;
  note: string | null;
  archived: boolean;
  savedMinor: number;
  remainingMinor: number;
  progress: number;
  monthsLeft: number | null;
  monthlyNeededMinor: number | null;
  avgMonthlyMinor: number;
  projectedOn: string | null;
  onTrack: boolean | null;
}

export interface GoalInput {
  id?: string;
  title: string;
  targetMinor: number;
  targetOn?: string | null;
  color?: string | null;
  icon?: string | null;
  note?: string | null;
  archived?: boolean;
  initialMinor?: number | null;
}

export interface Allocation {
  id: string;
  goalId: string;
  amountMinor: number;
  occurredOn: string;
  note: string | null;
}

export type BudgetPeriod = "day" | "week" | "month" | "year";

export interface Budget {
  id: string;
  categoryId: string;
  period: BudgetPeriod;
  limitMinor: number;
  currency: string;
  from: string;
  to: string;
  spentMinor: number;
  remainingMinor: number;
  progress: number;
  projectedMinor: number;
  daysLeft: number;
}

export interface BudgetInput {
  id?: string;
  categoryId: string;
  period: BudgetPeriod;
  limitMinor: number;
}

export interface ForecastDay {
  date: string;
  balanceMinor: number;
  incomeMinor: number;
  expenseMinor: number;
}

export interface AccountSeries {
  accountId: string;
  balances: number[];
}

export interface Forecast {
  currency: string;
  startBalanceMinor: number;
  days: ForecastDay[];
  events: Occurrence[];
  minBalanceMinor: number;
  minBalanceOn: string;
  endBalanceMinor: number;
  nextIncome: Occurrence | null;
  safeDailyMinor: number;
  safeTotalMinor: number;
  safeUntil: string;
  dailyVariableMinor: number;
  budgetsIncluded: boolean;
  budgetReservedMinor: number;
  accounts: AccountSeries[];
}

export interface PlannedBudget {
  budgetId: string;
  categoryId: string;
  amountMinor: number;
}

export interface MonthPreview {
  month: string;
  from: string;
  to: string;
  currency: string;
  expectedIncomeMinor: number;
  fixedExpenseMinor: number;
  variableExpenseMinor: number;
  budgetExpenseMinor: number;
  budgets: PlannedBudget[];
  savingsTargetMinor: number;
  freeMinor: number;
  startBalanceMinor: number;
  endBalanceMinor: number;
  items: Occurrence[];
  isCurrent: boolean;
}

export interface MonthTotals {
  month: string;
  incomeMinor: number;
  expenseMinor: number;
}

export type Severity = "critical" | "warning" | "info" | "success";

export interface Insight {
  id: string;
  kind:
    | "confirm_pending"
    | "income_soon"
    | "income_next"
    | "payment_today"
    | "payment_soon"
    | "low_balance"
    | "balance_negative"
    | "debt_due"
    | "debt_overdue"
    | "budget_over"
    | "budget_warn"
    | "budget_trend"
    | "goal_reached"
    | "goal_behind";
  severity: Severity;
  date: string | null;
  days: number | null;
  amountMinor: number | null;
  currency: string | null;
  title: string | null;
  refId: string | null;
  ratio: number | null;
}

export type SettingKey =
  | "remind_days"
  | "notifications"
  | "onboarded"
  | "ocr_engine"
  | "llm_enabled"
  | "llm_url"
  | "llm_model"
  | "llm_vision"
  | "device_name"
  | "discoverable"
  | "daily_done"
  | "daily_reminder"
  | "plan_budgets";

export const planning = {
  getSettings: () => invoke<Partial<Record<SettingKey, string>>>("get_settings"),
  setSetting: (key: SettingKey, value: string) => invoke<void>("set_setting", { key, value }),
  deleteAccount: (id: string) => invoke<void>("delete_account", { id }),
  deleteCategory: (id: string) => invoke<void>("delete_category", { id }),

  listRecurring: () => invoke<RecurringRule[]>("list_recurring"),
  upsertRecurring: (input: RecurringInput) => invoke<RecurringRule>("upsert_recurring", { input }),
  deleteRecurring: (id: string) => invoke<void>("delete_recurring", { id }),
  confirmOccurrence: (ruleId: string, date: string, amountMinor?: number) =>
    invoke<string>("confirm_occurrence", { ruleId, date, amountMinor }),
  skipOccurrence: (ruleId: string, date: string) => invoke<void>("skip_occurrence", { ruleId, date }),
  upcoming: (days: number) => invoke<Occurrence[]>("upcoming", { days }),
  runScheduler: () => invoke<number>("run_scheduler"),

  listDebts: () => invoke<Debt[]>("list_debts"),
  upsertDebt: (input: DebtInput) => invoke<Debt>("upsert_debt", { input }),
  deleteDebt: (id: string) => invoke<void>("delete_debt", { id }),
  recordDebtPayment: (debtId: string, amountMinor: number, date: string, accountId: string) =>
    invoke<Debt>("record_debt_payment", { debtId, amountMinor, date, accountId }),

  listGoals: () => invoke<Goal[]>("list_goals"),
  upsertGoal: (input: GoalInput) => invoke<Goal>("upsert_goal", { input }),
  deleteGoal: (id: string) => invoke<void>("delete_goal", { id }),
  allocateGoal: (goalId: string, amountMinor: number, date: string, note?: string | null) =>
    invoke<Goal>("allocate_goal", { goalId, amountMinor, date, note }),
  goalAllocations: (goalId: string) => invoke<Allocation[]>("goal_allocations", { goalId }),

  listBudgets: () => invoke<Budget[]>("list_budgets"),
  upsertBudget: (input: BudgetInput) => invoke<Budget>("upsert_budget", { input }),
  deleteBudget: (id: string) => invoke<void>("delete_budget", { id }),

  forecast: (days: number) => invoke<Forecast>("forecast", { days }),
  monthPreview: (month: string) => invoke<MonthPreview>("month_preview", { month }),
  monthlySeries: (months: number) => invoke<MonthTotals[]>("monthly_series", { months }),
  insights: () => invoke<Insight[]>("insights"),

  exportCsv: (path: string) => invoke<number>("export_csv", { path }),
  exportData: (path: string, options: ExportOptions) => invoke<number>("export_data", { path, options }),
  backupDatabase: (path: string) => invoke<void>("backup_database", { path }),
  importTemplate: (path: string, delimiter: string) => invoke<void>("import_template", { path, delimiter }),
  importPreview: (text: string, options: ImportOptions) => invoke<ImportPreview>("import_preview", { text, options }),
  importCommit: (text: string, options: ImportOptions) => invoke<ImportResult>("import_commit", { text, options }),
};

export type Dataset = "transactions" | "accounts" | "categories" | "recurring" | "budgets" | "goals" | "debts";

export const DATASETS: Dataset[] = ["transactions", "accounts", "categories", "recurring", "budgets", "goals", "debts"];

export interface ExportOptions {
  datasets: Dataset[];
  delimiter: string;
  decimalComma: boolean;
  labels: Record<string, string>;
  filter?: TransactionFilter;
}

export interface ImportOptions {
  defaultAccountId?: string | null;
  autoCategory: boolean;
  skipDuplicates: boolean;
  keepBalances: boolean;
  labels: Record<string, string>;
}

export interface ImportPreview {
  columns: string[];
  totalRows: number;
  validRows: number;
  duplicates: number;
  errors: { line: number; code: string; value: string }[];
  newAccounts: string[];
  newCategories: string[];
  incomeMinor: number;
  expenseMinor: number;
  firstDate: string | null;
  lastDate: string | null;
  rows: {
    line: number;
    date: string;
    kind: TxKind;
    amountMinor: number;
    currency: string;
    account: string;
    category: string;
    title: string;
    duplicate: boolean;
  }[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  newAccounts: number;
  newCategories: number;
}

export interface LineItem {
  name: string;
  amountMinor: number;
  categoryHint?: string | null;
}

export interface Extracted {
  items?: LineItem[];
  merchant: string | null;
  date: string | null;
  time?: string | null;
  totalMinor: number | null;
  currency: string | null;
  categoryHint: string | null;
  source: "rules" | "llm";
}

export interface Attachment {
  id: string;
  transactionId: string | null;
  sha256: string;
  mime: string;
  fileName: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  ocrText: string | null;
  ocrEngine: string | null;
  extracted: Extracted | null;
  createdAt: string;
  available: boolean;
}

export interface BookReceiptInput {
  date: string;
  time?: string | null;
  accountId: string;
  counterparty: string | null;
  title: string;
  parts: { categoryId: string | null; amountMinor: number; note: string | null }[];
}

export interface OcrStatus {
  tesseract: string | null;
  tesseractLangs: string[];
  ocrs: boolean;
}

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const receipts = {
  import: async (file: Blob, opts: { fileName?: string; transactionId?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.fileName) headers["x-file-name"] = encodeURIComponent(opts.fileName);
    if (opts.transactionId) headers["x-transaction-id"] = opts.transactionId;
    const body = isAndroid ? { b64: await toBase64(file) } : new Uint8Array(await file.arrayBuffer());
    return invoke<Attachment>("import_receipt", body, { headers });
  },
  list: (filter?: { inbox?: boolean; transactionId?: string }) =>
    invoke<Attachment[]>("list_attachments", { filter }),
  link: (id: string, transactionId: string | null) =>
    invoke<Attachment>("link_attachment", { id, transactionId }),
  book: (id: string, input: BookReceiptInput) => invoke<string[]>("book_receipt", { id, input }),
  delete: (id: string) => invoke<void>("delete_attachment", { id }),
  reprocess: (id: string) => invoke<Attachment>("reprocess_attachment", { id }),
  image: (id: string, thumb: boolean) => invoke<ArrayBuffer>("attachment_image", { id, thumb }),
  ocrStatus: () => invoke<OcrStatus>("ocr_status"),
  llmModels: (url: string) => invoke<string[]>("llm_models", { url }),
  suggestCategory: (name: string) => invoke<string | null>("suggest_category", { name }),
};

export type PeerRole = "full" | "view" | "capture";

export interface PeerView {
  publicKey: string;
  name: string;
  paired: boolean;
  role: PeerRole | null;
  connected: boolean;
  addr: string | null;
  lastSeen: string | null;
}

export interface SyncStatus {
  name: string;
  publicKey: string;
  fingerprint: string;
  port: number;
  addresses: string[];
  enabled: boolean;
  discoverable: boolean;
  peers: PeerView[];
  pairingCode: string | null;
  pairingExpiresIn: number | null;
  pairingRequest: string | null;
  pairingRole: PeerRole | null;
  scanning: boolean;
}

export const demo = {
  loaded: () => invoke<boolean>("demo_loaded"),
  load: (lang?: string) => invoke<void>("load_demo_data", { lang }),
  clear: () => invoke<number>("clear_demo_data"),
};

export const sync = {
  status: () => invoke<SyncStatus>("sync_status"),
  startPairing: () => invoke<string>("sync_start_pairing"),
  stopPairing: () => invoke<void>("sync_stop_pairing"),
  setPairingRole: (role: PeerRole) => invoke<void>("sync_set_pairing_role", { role }),
  pair: (addr: string, code: string) => invoke<string>("sync_pair", { addr, code }),
  requestPairing: (addr: string) => invoke<string>("sync_request_pairing", { addr }),
  now: () => invoke<void>("sync_now"),
  scan: () => invoke<number>("sync_scan"),
  connect: (addr: string) => invoke<void>("sync_connect", { addr }),
  unpair: (publicKey: string) => invoke<void>("sync_unpair", { publicKey }),
  setRole: (publicKey: string, role: PeerRole) => invoke<void>("sync_set_role", { publicKey, role }),
  setEnabled: (enabled: boolean) => invoke<void>("sync_set_enabled", { enabled }),
};
