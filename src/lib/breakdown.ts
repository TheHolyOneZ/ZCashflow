import type { Category, CategorySum } from "@/lib/api";

export interface BreakdownNode {
  id: string;
  category: Category | null;
  own: number;
  total: number;
  count: number;
  children: BreakdownNode[];
}

export function currenciesOf(sums: CategorySum[], preferred?: string): string[] {
  const weight = new Map<string, number>();
  for (const s of sums) weight.set(s.currency, (weight.get(s.currency) ?? 0) + s.count);
  return [...weight.keys()].sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : (weight.get(b) ?? 0) - (weight.get(a) ?? 0)));
}

export function breakdown(categories: Category[], sums: CategorySum[], kind: "income" | "expense", currency: string): BreakdownNode[] {
  const known = new Map(categories.map((c) => [c.id, c]));
  const own = new Map<string, { total: number; count: number }>();
  for (const s of sums) {
    if (s.kind !== kind || s.currency !== currency) continue;
    const key = s.categoryId && known.has(s.categoryId) ? s.categoryId : "";
    const prev = own.get(key) ?? { total: 0, count: 0 };
    own.set(key, { total: prev.total + s.totalMinor, count: prev.count + s.count });
  }
  const list = categories.filter((c) => c.kind === kind || c.kind === "both" || own.has(c.id));
  const ids = new Set(list.map((c) => c.id));
  const position = new Map(list.map((c, i) => [c.id, i]));
  const children = new Map<string | null, Category[]>();
  for (const c of list) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), c]);
  }
  const sort = (nodes: BreakdownNode[]) =>
    nodes.sort((a, b) => b.total - a.total || (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity));
  const seen = new Set<string>();
  const build = (c: Category): BreakdownNode => {
    seen.add(c.id);
    const kids = sort((children.get(c.id) ?? []).filter((k) => !seen.has(k.id)).map(build));
    const mine = own.get(c.id) ?? { total: 0, count: 0 };
    return {
      id: c.id,
      category: c,
      own: mine.total,
      total: mine.total + kids.reduce((sum, k) => sum + k.total, 0),
      count: mine.count + kids.reduce((sum, k) => sum + k.count, 0),
      children: kids,
    };
  };
  const roots = (children.get(null) ?? []).map(build);
  const none = own.get("");
  if (none) roots.push({ id: "", category: null, own: none.total, total: none.total, count: none.count, children: [] });
  return sort(roots);
}

export function nodeTotal(nodes: BreakdownNode[]): number {
  return nodes.reduce((sum, n) => sum + n.total, 0);
}
