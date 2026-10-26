import type { Account, Category } from "@/lib/api";
import i18n, { displayName } from "@/lib/i18n";

export interface TreeNode {
  category: Category;
  depth: number;
}

export function categoryTree(categories: Category[]): TreeNode[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<string | null, Category[]>();
  for (const c of categories) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), c]);
  }
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ category: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const c of categories) if (!seen.has(c.id)) out.push({ category: c, depth: 0 });
  return out;
}

export function subtreeIds(categories: Category[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

export function categoryPath(categories: Category[], id: string | null | undefined): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parts: string[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current && parts.length < 32) {
    parts.unshift(displayName(current));
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(" › ");
}

export function systemLabels(categories: Category[], accounts: Account[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const row of [...categories, ...accounts]) {
    if (row.systemKey) labels[row.systemKey] = i18n.t(row.systemKey, { defaultValue: row.name });
  }
  return labels;
}
