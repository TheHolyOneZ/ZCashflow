import type { CategoryFile, CategoryNode } from "@/lib/api";

export type FileWarning =
  | { kind: "icon"; path: string; value: string }
  | { kind: "color"; path: string; value: string }
  | { kind: "name"; path: string };

export type ParseResult = { ok: true; file: CategoryFile; warnings: FileWarning[]; count: number } | { ok: false; error: "json" | "shape" | "empty" };

const ALIASES: Record<string, string> = {
  home: "house",
  rent: "house",
  "water-drop": "droplet",
  water: "droplet",
  cable: "plug",
  power: "plug",
  electricity: "zap",
  bolt: "zap",
  flash: "zap",
  restaurant: "utensils",
  food: "utensils",
  fastfood: "utensils",
  "local-cafe": "coffee",
  cafe: "coffee",
  "shopping-cart": "shopping-basket",
  cart: "shopping-basket",
  groceries: "shopping-basket",
  "local-grocery-store": "shopping-basket",
  shopping: "shopping-bag",
  "directions-car": "car",
  "local-gas-station": "fuel",
  gas: "fuel",
  "directions-bus": "bus",
  "directions-bike": "bike",
  "pedal-bike": "bike",
  flight: "plane",
  phone: "smartphone",
  "phone-android": "smartphone",
  "phone-iphone": "smartphone",
  computer: "laptop",
  medical: "pill",
  medication: "pill",
  health: "heart-pulse",
  "fitness-center": "dumbbell",
  school: "graduation-cap",
  book: "book-open",
  pets: "cat",
  "child-care": "baby",
  build: "wrench",
  work: "briefcase",
  savings: "piggy-bank",
  payments: "banknote",
  money: "banknote",
  "account-balance": "landmark",
  bank: "landmark",
  "card-giftcard": "gift",
  "beach-access": "palmtree",
  subscriptions: "repeat",
  movie: "tv",
  "music-note": "music",
  "sports-esports": "gamepad-2",
  games: "gamepad-2",
  checkroom: "shirt",
};

export function iconFor(raw: string, known: Set<string>): string | null {
  const key = raw.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (known.has(key)) return key;
  const alias = ALIASES[key];
  return alias && known.has(alias) ? alias : null;
}

function colorOf(raw: string): string | null {
  const hex = raw.trim().replace(/^#/, "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return `#${full.toLowerCase()}`;
}

export function parseCategoryFile(text: string, icons: Iterable<string>): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "json" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "shape" };
  const known = new Set(icons);
  const warnings: FileWarning[] = [];
  let count = 0;
  const obj = raw as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((k) => obj[k]).find((v) => v !== undefined);

  const walk = (list: unknown, trail: string[]): CategoryNode[] | null => {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) return null;
    const out: CategoryNode[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const n = item as Record<string, unknown>;
      const name = typeof n.name === "string" ? n.name.trim() : "";
      const path = [...trail, name || "?"].join(" > ");
      if (!name) {
        warnings.push({ kind: "name", path });
        continue;
      }
      const node: CategoryNode = { name, subcategories: [] };
      const symbol = typeof n.symbol === "string" ? n.symbol : typeof n.icon === "string" ? n.icon : undefined;
      if (symbol?.trim()) {
        const icon = iconFor(symbol, known);
        if (icon) node.symbol = icon;
        else warnings.push({ kind: "icon", path, value: symbol });
      }
      if (typeof n.color === "string" && n.color.trim()) {
        const color = colorOf(n.color);
        if (color) node.color = color;
        else warnings.push({ kind: "color", path, value: n.color });
      }
      const subs = walk(n.subcategories ?? n.children, [...trail, name]);
      if (!subs) return null;
      node.subcategories = subs;
      count += 1;
      out.push(node);
    }
    return out;
  };

  const out = walk(pick("out", "expense", "expenses"), []);
  const income = walk(pick("in", "income"), []);
  const both = walk(pick("both"), []);
  if (!out || !income || !both) return { ok: false, error: "shape" };
  if (!count) return { ok: false, error: "empty" };
  return { ok: true, file: { out, in: income, both }, warnings, count };
}
