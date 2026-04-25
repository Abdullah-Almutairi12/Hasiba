import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./ar.json";
import en from "./en.json";

export const SUPPORTED_LANGUAGES = ["ar", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "hasba.lang";

function detectInitialLanguage(): Language {
  if (typeof window === "undefined") return "ar";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "ar" || stored === "en") return stored;
  return "ar";
}

const initialLang = detectInitialLanguage();

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: initialLang,
  fallbackLng: "ar",
  interpolation: { escapeValue: false },
});

if (typeof document !== "undefined") {
  document.documentElement.lang = initialLang;
  document.documentElement.dir = initialLang === "ar" ? "rtl" : "ltr";
}

export function persistLanguage(lang: Language) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, lang);
}

export default i18n;
