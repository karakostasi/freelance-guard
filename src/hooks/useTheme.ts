import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "squirrel-theme";
const COLORS: Record<Theme, string> = { dark: "#0d0f14", light: "#f4f6fb" };

/** The saved choice. Dark, the original look, until someone picks the light one. index.html applies it before the first paint. */
function saved(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
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
