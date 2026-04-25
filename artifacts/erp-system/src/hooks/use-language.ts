import { useTranslation } from "react-i18next";
import { persistLanguage, type Language } from "@/i18n";

export function useLanguage() {
  const { i18n, t } = useTranslation();
  const language = (i18n.language as Language) ?? "ar";
  const isRTL = language === "ar";

  const setLanguage = async (next: Language) => {
    if (next === language) return;
    await i18n.changeLanguage(next);
    persistLanguage(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
      document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    }
  };

  const toggleLanguage = () => {
    void setLanguage(language === "ar" ? "en" : "ar");
  };

  return { language, isRTL, setLanguage, toggleLanguage, t };
}
