import {
  ArrowLeftRight,
  Baby,
  Banknote,
  Bike,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Cat,
  CircleDashed,
  Coffee,
  Coins,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  Music,
  Palmtree,
  PiggyBank,
  Pill,
  Plane,
  Plug,
  Receipt,
  Repeat,
  Shield,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Train,
  TrendingUp,
  Tv,
  Utensils,
  Wifi,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Category, TxKind } from "@/lib/api";
import { cn } from "@/lib/cn";

export const icons: Record<string, LucideIcon> = {
  "shopping-basket": ShoppingBasket,
  utensils: Utensils,
  coffee: Coffee,
  house: House,
  plug: Plug,
  wifi: Wifi,
  smartphone: Smartphone,
  bus: Bus,
  train: Train,
  car: Car,
  fuel: Fuel,
  bike: Bike,
  plane: Plane,
  repeat: Repeat,
  tv: Tv,
  music: Music,
  "shopping-bag": ShoppingBag,
  shirt: Shirt,
  laptop: Laptop,
  gift: Gift,
  "heart-pulse": HeartPulse,
  pill: Pill,
  dumbbell: Dumbbell,
  shield: Shield,
  "gamepad-2": Gamepad2,
  "book-open": BookOpen,
  "graduation-cap": GraduationCap,
  baby: Baby,
  cat: Cat,
  wrench: Wrench,
  receipt: Receipt,
  landmark: Landmark,
  "hand-coins": HandCoins,
  briefcase: Briefcase,
  coins: Coins,
  banknote: Banknote,
  "trending-up": TrendingUp,
  "piggy-bank": PiggyBank,
  palmtree: Palmtree,
  sparkles: Sparkles,
  "circle-dashed": CircleDashed,
};

export function NamedIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = (name && icons[name]) || CircleDashed;
  return <Icon className={className} />;
}

export function IconTile({
  icon,
  color,
  className,
  iconClassName = "size-4",
}: {
  icon: string | LucideIcon | null | undefined;
  color: string | null | undefined;
  className?: string;
  iconClassName?: string;
}) {
  const c = color ?? "var(--muted)";
  const Icon = typeof icon === "string" || icon == null ? (icon && icons[icon]) || CircleDashed : icon;
  return (
    <span
      aria-hidden
      className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px]", className)}
      style={{ backgroundColor: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}
    >
      <Icon className={iconClassName} />
    </span>
  );
}

export function CategoryIcon({
  category,
  kind,
  className,
  debt,
}: {
  category?: Category | null;
  kind?: TxKind;
  className?: string;
  debt?: boolean;
}) {
  if (kind === "transfer") return <IconTile icon={ArrowLeftRight} color="var(--transfer)" className={className} />;
  if (!category && debt) return <IconTile icon={HandCoins} color="var(--warn)" className={className} />;
  return <IconTile icon={category?.icon} color={category?.color} className={className} />;
}

export function IconPicker({
  value,
  color,
  onChange,
}: {
  value: string | null;
  color: string | null;
  onChange: (name: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-1 sm:grid-cols-10" role="radiogroup">
      {Object.entries(icons).map(([name, Icon]) => {
        const active = value === name;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={name}
            onClick={() => onChange(name)}
            className={cn(
              "flex aspect-square items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active && "text-white hover:text-white",
            )}
            style={active ? { backgroundColor: color ?? "var(--accent)" } : undefined}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
