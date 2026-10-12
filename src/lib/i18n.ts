import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";
import it from "@/locales/it.json";
import pl from "@/locales/pl.json";
import tr from "@/locales/tr.json";

export const languages = [
  { code: "de", label: "Deutsch", locale: "de-DE" },
  { code: "en", label: "English", locale: "en-US" },
  { code: "es", label: "Español", locale: "es-ES" },
  { code: "fr", label: "Français", locale: "fr-FR" },
  { code: "it", label: "Italiano", locale: "it-IT" },
  { code: "pl", label: "Polski", locale: "pl-PL" },
  { code: "tr", label: "Türkçe", locale: "tr-TR" },
] as const;

export type LanguageCode = (typeof languages)[number]["code"];

const STORAGE_KEY = "zc.language";

function initialLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (languages.some((l) => l.code === stored)) return stored as LanguageCode;
  } catch {
  }
  const nav = navigator.language.slice(0, 2);
  return languages.some((l) => l.code === nav) ? (nav as LanguageCode) : "en";
}

i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    it: { translation: it },
    pl: { translation: pl },
    tr: { translation: tr },
  },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
  }
});
document.documentElement.lang = i18n.language;

export function activeLocale(): string {
  return languages.find((l) => l.code === i18n.language)?.locale ?? "en-US";
}

export function displayName(row: { name: string; systemKey: string | null }): string {
  return row.systemKey ? i18n.t(row.systemKey, { defaultValue: row.name }) : row.name;
}

export default i18n;
