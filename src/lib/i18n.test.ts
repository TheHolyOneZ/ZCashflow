import { describe, expect, it } from "vitest";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";
import itLocale from "@/locales/it.json";
import pl from "@/locales/pl.json";
import tr from "@/locales/tr.json";

const locales: Record<string, object> = { de, en, es, fr, it: itLocale, pl, tr };
const PLURAL = /_(zero|one|two|few|many|other)$/;

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function values(obj: object, prefix = ""): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? values(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)] as [string, string]],
  );
}

const placeholders = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();

function integerCategories(lang: string): Set<string> {
  const rules = new Intl.PluralRules(lang);
  const samples = [...Array(250).keys(), 1000, 1_000_000, 2_000_000];
  return new Set(samples.map((n) => rules.select(n)));
}

describe("locales", () => {
  const enKeys = keys(en);
  const enBases = new Set(enKeys.map((k) => k.replace(PLURAL, "")));
  const pluralBases = new Set(enKeys.filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));

  for (const [lang, data] of Object.entries(locales)) {
    it(`${lang} has every key, no extras, and every plural form it needs`, () => {
      const own = keys(data);
      const bases = new Set(own.map((k) => k.replace(PLURAL, "")));
      expect([...enBases].filter((b) => !bases.has(b))).toEqual([]);
      expect([...bases].filter((b) => !enBases.has(b))).toEqual([]);
      const all = new Set(own);
      const missing: string[] = [];
      for (const base of pluralBases) {
        for (const cat of integerCategories(lang)) if (!all.has(`${base}_${cat}`)) missing.push(`${base}_${cat}`);
      }
      expect(missing).toEqual([]);
    });

    it(`${lang} keeps every placeholder`, () => {
      const enValues = new Map(values(en));
      const wrong = values(data).filter(([k, v]) => {
        const ref = enValues.get(k) ?? enValues.get(k.replace(PLURAL, "_other"));
        return ref !== undefined && placeholders(v).join() !== placeholders(ref).join();
      });
      expect(wrong).toEqual([]);
    });
  }

  it("every seeded system key has a translation", () => {
    const seeded = [
      "account.cash",
      ...["groceries", "food", "housing", "utilities", "transport", "subscriptions",
        "shopping", "health", "leisure", "other_expense", "salary", "other_income"]
        .map((c) => `category.${c}`),
    ];
    for (const locale of Object.values(locales)) {
      const all = new Set(keys(locale));
      for (const k of seeded) expect(all.has(k), k).toBe(true);
    }
  });
});
