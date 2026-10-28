import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import styles from "../App.module.css";

/** The switch between the dark and the light theme, in the header. The icon shows the theme you would switch to. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button className={styles.themeButton} onClick={toggle} aria-label={`Switch to the ${next} theme`} title={`Switch to the ${next} theme`}>
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
