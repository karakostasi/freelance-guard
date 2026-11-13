import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "squirrel-theme";
const COLORS: Record<Theme, string> = { dark: "#0e1320", light: "#f5f6f8" };

/** The saved choice. Light until someone picks the dark one. index.html applies a saved dark choice before the first paint. */
function saved(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Dark or light, remembered in this browser. The theme itself is the `data-theme` attribute of <html>, which the CSS tokens follow. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(saved);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLORS[theme]);
  }, [theme]);

  const choose = useCallback((next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private windows can refuse storage. The choice then lasts until the page closes.
    }
  }, []);

  return { theme, toggle: () => choose(theme === "dark" ? "light" : "dark") };
}
