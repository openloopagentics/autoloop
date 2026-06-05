export interface ThemeOption { id: string; label: string; swatch: string; }

/** The selectable themes. `id` maps to a [data-surface="<id>"] block in index.css. */
export const THEMES: ThemeOption[] = [
  { id: "dark", label: "Espresso", swatch: "#b89058" },
  { id: "light", label: "Daylight", swatch: "#2563eb" },
  { id: "midnight", label: "Midnight", swatch: "#4db5e8" },
  { id: "forest", label: "Forest", swatch: "#5fb87a" },
  { id: "nord", label: "Nord", swatch: "#88c0d0" },
  { id: "rose", label: "Rosé", swatch: "#d98bb0" },
];

const STORAGE_KEY = "autoloop-theme";
const DEFAULT_THEME = "dark";

export function getTheme(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) return saved;
  } catch { /* localStorage unavailable */ }
  return DEFAULT_THEME;
}

export function applyTheme(id: string): void {
  document.documentElement.dataset.surface = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
}
