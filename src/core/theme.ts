import type { Theme } from "./adapter";

/**
 * Bridge Obsidian's active theme into a plain object diagrams can consume.
 * Reads computed CSS custom properties from the document body.
 */
export function readObsidianTheme(): Theme {
  const styles = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => {
    const val = styles.getPropertyValue(name).trim();
    return val || fallback;
  };

  const isDark = document.body.classList.contains("theme-dark");

  return {
    isDark,
    colors: {
      background: v("--background-primary", isDark ? "#1e1e1e" : "#ffffff"),
      backgroundSecondary: v("--background-secondary", isDark ? "#262626" : "#f5f5f5"),
      border: v("--background-modifier-border", isDark ? "#363636" : "#e0e0e0"),
      text: v("--text-normal", isDark ? "#dcddde" : "#1a1a1a"),
      textMuted: v("--text-muted", isDark ? "#999999" : "#888888"),
      accent: v("--interactive-accent", "#6965db"),
    },
  };
}
