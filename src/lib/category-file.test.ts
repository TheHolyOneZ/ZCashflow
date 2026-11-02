import { describe, expect, it } from "vitest";
import { iconFor, parseCategoryFile } from "./category-file";

const icons = ["house", "plug", "droplet", "zap", "coffee", "circle-dashed"];

const sample = JSON.stringify({
  out: [
    {
      name: "Wohnen",
      symbol: "house",
      subcategories: [
        { name: "Miete", symbol: "house", subcategories: [{ name: "miete-1", symbol: "house", subcategories: [] }] },
        { name: "Strom", symbol: "cable", color: "#F80", subcategories: [] },
        { name: "Wasser", symbol: "water_drop", subcategories: [] },
      ],
    },
  ],
  in: [],
});

describe("parseCategoryFile", () => {
  it("reads nested categories and maps common icon names", () => {
    const r = parseCategoryFile(sample, icons);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.count).toBe(5);
    expect(r.warnings).toEqual([]);
    const home = r.file.out[0];
    expect(home.subcategories.map((n) => [n.name, n.symbol, n.color])).toEqual([
      ["Miete", "house", undefined],
      ["Strom", "plug", "#ff8800"],
      ["Wasser", "droplet", undefined],
    ]);
    expect(home.subcategories[0].subcategories[0].name).toBe("miete-1");
  });

  it("reports unknown icons, bad colors and missing names without failing", () => {
    const r = parseCategoryFile(
      JSON.stringify({ in: [{ name: "Gehalt", symbol: "rocket", color: "blue" }, { name: " " }], expense: [{ name: "Tee", icon: "Coffee" }] }),
      icons,
    );
    expect(r.ok && r.warnings.map((w) => w.kind)).toEqual(["icon", "color", "name"]);
    expect(r.ok && r.file.out[0].symbol).toBe("coffee");
    expect(r.ok && r.file.in[0].symbol).toBeUndefined();
  });

  it("rejects broken files", () => {
    expect(parseCategoryFile("{", icons)).toEqual({ ok: false, error: "json" });
    expect(parseCategoryFile("[]", icons)).toEqual({ ok: false, error: "shape" });
    expect(parseCategoryFile(JSON.stringify({ out: [{ name: "A", subcategories: "x" }] }), icons)).toEqual({ ok: false, error: "shape" });
    expect(parseCategoryFile(JSON.stringify({ out: [], in: [] }), icons)).toEqual({ ok: false, error: "empty" });
  });

  it("normalizes icon names", () => {
    const known = new Set(icons);
    expect(iconFor("House", known)).toBe("house");
    expect(iconFor("water drop", known)).toBe("droplet");
    expect(iconFor("unknown", known)).toBeNull();
  });
});
