import { describe, expect, it } from "vitest";
import { formatMoney, minorToInput, parseMoney } from "./money";

describe("parseMoney", () => {
  it.each([
    ["8,50", 850],
    ["8.5", 850],
    ["12", 1200],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1.000", 100000],
    ["60 €", 6000],
  ])("%s -> %d", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(["", "abc", "0", "-5", "1e5"])("rejects %j", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it("respects zero-decimal currencies", () => {
    expect(parseMoney("1.500", "JPY")).toBe(1500);
  });
});

describe("formatMoney", () => {
  it("formats per locale", () => {
    expect(formatMoney(123456, "EUR", "de-DE")).toBe("1.234,56 €");
    expect(formatMoney(123456, "EUR", "en-US")).toBe("€1,234.56");
  });

  it("can force a sign", () => {
    expect(formatMoney(850, "EUR", "en-US", { signed: true })).toBe("+€8.50");
    expect(formatMoney(-850, "EUR", "en-US", { signed: true })).toBe("-€8.50");
  });
});

describe("minorToInput", () => {
  it("round-trips through parseMoney", () => {
    const s = minorToInput(123456, "EUR", "de-DE");
    expect(s).toBe("1234,56");
    expect(parseMoney(s)).toBe(123456);
  });
});

import { maskParts } from "./money";

describe("privacy mask", () => {
  it("hides digits but keeps sign and currency", () => {
    const f = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", signDisplay: "always" });
    expect(maskParts(f.formatToParts(-1234.56)).replace(/\s/g, " ")).toBe("-•••,•• €");
    const c = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" });
    expect(maskParts(c.formatToParts(12000))).toBe("$•••");
  });
});
