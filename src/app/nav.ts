import {
  ArrowLeftRight,
  CalendarClock,
  CalendarRange,
  HandCoins,
  Info,
  Landmark,
  MonitorSmartphone,
  LayoutDashboard,
  PieChart,
  PiggyBank,
  ScanLine,
  Settings,
  Shapes,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  group: "main" | "plan" | "manage";

  primary?: boolean;
  noShortcut?: boolean;
}

export const navItems: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, group: "main", primary: true },
  { to: "/transactions", labelKey: "nav.transactions", icon: ArrowLeftRight, group: "main", primary: true },
  { to: "/statistics", labelKey: "nav.statistics", icon: PieChart, group: "main", noShortcut: true },
  { to: "/receipts", labelKey: "nav.receipts", icon: ScanLine, group: "main", primary: true },
  { to: "/planner", labelKey: "nav.planner", icon: CalendarRange, group: "main" },
  { to: "/recurring", labelKey: "nav.recurring", icon: CalendarClock, group: "plan" },
  { to: "/debts", labelKey: "nav.debts", icon: HandCoins, group: "plan" },
  { to: "/goals", labelKey: "nav.goals", icon: PiggyBank, group: "plan" },
  { to: "/budgets", labelKey: "nav.budgets", icon: Wallet, group: "plan" },
  { to: "/accounts", labelKey: "nav.accounts", icon: Landmark, group: "manage" },
  { to: "/categories", labelKey: "nav.categories", icon: Shapes, group: "manage" },
  { to: "/devices", labelKey: "nav.devices", icon: MonitorSmartphone, group: "manage" },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, group: "manage" },
  { to: "/about", labelKey: "nav.about", icon: Info, group: "manage" },
];

export const shortcutItems = navItems.filter((n) => !n.noShortcut).slice(0, 9);

export const navGroups = ["main", "plan", "manage"] as const;
