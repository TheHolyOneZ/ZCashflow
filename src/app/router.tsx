import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AccountsPage } from "@/features/accounts/AccountsPage";
import { BudgetsPage } from "@/features/budgets/BudgetsPage";
import { CategoriesPage } from "@/features/categories/CategoriesPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { DebtsPage } from "@/features/debts/DebtsPage";
import { DevicesPage } from "@/features/devices/DevicesPage";
import { GoalsPage } from "@/features/goals/GoalsPage";
import { PlannerPage } from "@/features/planner/PlannerPage";
import { ReceiptsPage } from "@/features/receipts/ReceiptsPage";
import { RecurringPage } from "@/features/recurring/RecurringPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { StatisticsPage } from "@/features/statistics/StatisticsPage";
import { AboutPage } from "@/features/settings/AboutPage";
import { TodayPage } from "@/features/today/TodayPage";
import { TransactionsPage } from "@/features/transactions/TransactionsPage";
import { AppShell } from "./AppShell";
import { ErrorView } from "./ErrorView";

const rootRoute = createRootRoute({ component: AppShell });

const page = <P extends string>(path: P, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  component: TransactionsPage,
  validateSearch: (s: Record<string, unknown>): { q?: string; category?: string; from?: string; to?: string } => ({
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
    ...(typeof s.category === "string" ? { category: s.category } : {}),
    ...(typeof s.from === "string" && s.from ? { from: s.from } : {}),
    ...(typeof s.to === "string" && s.to ? { to: s.to } : {}),
  }),
});

const routeTree = rootRoute.addChildren([
  page("/", DashboardPage),
  page("/today", TodayPage),
  transactionsRoute,
  page("/statistics", StatisticsPage),
  page("/receipts", ReceiptsPage),
  page("/planner", PlannerPage),
  page("/recurring", RecurringPage),
  page("/debts", DebtsPage),
  page("/goals", GoalsPage),
  page("/budgets", BudgetsPage),
  page("/accounts", AccountsPage),
  page("/categories", CategoriesPage),
  page("/devices", DevicesPage),
  page("/settings", SettingsPage),
  page("/about", AboutPage),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultErrorComponent: ({ error, reset }) => <ErrorView error={error} reset={reset} />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
