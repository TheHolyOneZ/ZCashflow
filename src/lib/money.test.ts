import { describe, expect, it } from "vitest";
import { dropCurrency, formatMoney, groupAmount, minorToInput, parseMoney, ungroupAmount } from "./money";

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

describe("dropCurrency", () => {
  const plain = (locale: string, currency: string, value: number) =>
    dropCurrency(new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(value))
      .map((p) => p.value)
      .join("");

  it.each([
    ["de-DE", "EUR", -1234.5, "-1.234,50"],
    ["en-US", "USD", -20, "-20.00"],
    ["en-US", "LKR", 485207.58, "485,207.58"],
    ["nl-NL", "EUR", -12.5, "-12,50"],
    ["fr-FR", "EUR", 12.5, "12,50"],
  ])("%s %s %d -> %s", (locale, currency, value, expected) => {
    expect(plain(locale, currency, value).replace(/−/g, "-").replace(/[  ]/g, " ")).toBe(expected.replace(/[  ]/g, " "));
  });
});

describe("groupAmount", () => {
  it.each([
    ["1234567", "de-DE", "1.234.567"],
    ["1234567", "en-US", "1,234,567"],
    ["1234,5", "de-DE", "1.234,5"],
    ["1234.5", "de-DE", "1.234,5"],
    ["1234,", "de-DE", "1.234,"],
    ["12,345", "en-US", "12,345"],
    ["1.234.567,89", "de-DE", "1.234.567,89"],
    ["-2500", "en-US", "-2,500"],
    ["12+5", "en-US", "12+5"],
    ["", "en-US", ""],
  ])("groups %s in %s as %s", (input, locale, expected) => {
    expect(groupAmount(input, "EUR", locale)).toBe(expected);
  });

  it("never changes the amount that is read", () => {
    const inputs = ["1", "12", "1234", "1234,5", "1234.56", "12.345", "12,345", "1.234.567,8", "6434343131313", "1234,", "1234.", "0,5", "999999,99"];
    for (const locale of ["de-DE", "en-US", "fr-FR", "pl-PL", "ru-RU", "tr-TR", "it-IT", "es-ES", "de-CH"]) {
      for (const input of inputs) {
        expect(parseMoney(groupAmount(input, "EUR", locale), "EUR"), `${input} in ${locale}`).toBe(parseMoney(input, "EUR"));
      }
      expect(parseMoney(groupAmount("1234567", "JPY", locale), "JPY")).toBe(1234567);
    }
  });
});

describe("ungroupAmount", () => {
  it.each([
    ["12.934", 6, "typed", "de-DE", "12934"],
    ["12.93", 5, "deleted", "de-DE", "1293"],
    ["12.9345", 7, "typed", "de-DE", "129345"],
    ["129.345,", 8, "typed", "de-DE", "129345,"],
    ["129.345,567", 11, "typed", "de-DE", "129345,56"],
    ["1.234.", 6, "typed", "de-DE", "1234,"],
    ["12.", 3, "typed", "de-DE", "12,"],
    ["1,234", 5, "typed", "en-US", "1234"],
    ["1,23", 4, "deleted", "en-US", "123"],
    ["1,234.5", 7, "typed", "en-US", "1234.5"],
    ["12,", 3, "typed", "en-US", "12."],
    ["1234.56", 7, "pasted", "de-DE", "1234,56"],
    ["1.234", 5, "pasted", "de-DE", "1234"],
    ["1 234.5", 7, "typed", "fr-FR", "1234,5"],
    ["-1,250", 6, "typed", "en-US", "-1250"],
  ] as const)("reads %s (%s, %s) in %s as %s", (raw, caret, change, locale, expected) => {
    expect(ungroupAmount(raw, caret, change, "EUR", locale).text).toBe(expected);
  });

  it("keeps the caret on the same digit", () => {
    expect(ungroupAmount("1.2934", 4, "typed", "EUR", "de-DE")).toEqual({ text: "12934", caret: 3 });
    expect(ungroupAmount("1.234,5", 6, "typed", "EUR", "de-DE")).toEqual({ text: "1234,5", caret: 5 });
  });

  it("drops the decimal part for currencies without one", () => {
    expect(ungroupAmount("1,234.5", 7, "typed", "JPY", "en-US").text).toBe("12345");
  });

  it("round-trips through the grouped display", () => {
    for (const locale of ["de-DE", "en-US", "fr-FR", "pl-PL", "ru-RU", "tr-TR", "de-CH"]) {
      for (const state of ["1", "1234", "1234567", "6434343131313"]) {
        const shown = groupAmount(state, "EUR", locale);
        expect(ungroupAmount(shown, shown.length, "deleted", "EUR", locale).text, `${state} in ${locale}`).toBe(state);
      }
    }
  });
});
