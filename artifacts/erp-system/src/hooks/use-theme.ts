import { useEffect, useState, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "auto";

const STORAGE_KEY = "erp.theme";

function readStored(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "auto") return v;
  return "auto";
}

const listeners = new Set<(t: ThemeMode) => void>();

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(readStored);

  useEffect(() => {
    const handler = (t: ThemeMode) => setThemeState(t);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const setTheme = useCallback((t: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEY, t);
    listeners.forEach((l) => l(t));
  }, []);

  const cycle = useCallback(() => {
    const next: ThemeMode =
      theme === "light" ? "dark" : theme === "dark" ? "auto" : "light";
    setTheme(next);
  }, [theme, setTheme]);

  return { theme, setTheme, cycle };
}
