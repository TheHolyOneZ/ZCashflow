import { describe, expect, it } from "vitest";
import type { Category, CategorySum } from "./api";
import { breakdown, currenciesOf, nodeTotal } from "./breakdown";

const cat = (id: string, kind: Category["kind"], parentId: string | null = null): Category => ({
  id,
  parentId,
  name: id,
  systemKey: null,
  kind,
  icon: null,
  color: null,
});

const sum = (categoryId: string | null, totalMinor: number, kind: "income" | "expense" = "expense", currency = "LKR"): CategorySum => ({
  categoryId,
  kind,
  currency,
  count: 1,
  totalMinor,
});

const categories = [cat("office", "expense"), cat("tea", "expense", "office"), cat("power", "expense", "office"), cat("car", "expense"), cat("salary", "income")];

describe("breakdown", () => {
  it("rolls subcategories up and sorts by amount", () => {
    const nodes = breakdown(categories, [sum("tea", 300), sum("power", 5000), sum("office", 100), sum("car", 2000), sum("gone", 50), sum(null, 25)], "expense", "LKR");
    expect(nodes.map((n) => [n.id, n.total])).toEqual([
      ["office", 5400],
      ["car", 2000],
      ["", 75],
    ]);
    expect(nodes[0].own).toBe(100);
    expect(nodes[0].children.map((n) => n.id)).toEqual(["power", "tea"]);
    expect(nodeTotal(nodes)).toBe(7475);
  });

  it("keeps empty categories in their order and ignores other kinds and currencies", () => {
    const nodes = breakdown(categories, [sum("salary", 900, "income"), sum("car", 10, "expense", "EUR")], "expense", "LKR");
    expect(nodes.map((n) => [n.id, n.total])).toEqual([
      ["office", 0],
      ["car", 0],
    ]);
  });

  it("lists the preferred currency first, then the most used", () => {
    expect(currenciesOf([sum("a", 1, "expense", "EUR"), sum("b", 1, "expense", "USD"), sum("c", 1, "income", "USD")], "LKR")).toEqual(["USD", "EUR"]);
    expect(currenciesOf([sum("a", 1, "expense", "EUR"), sum("b", 1, "expense", "USD"), sum("c", 1, "income", "USD")], "EUR")).toEqual(["EUR", "USD"]);
  });
});
