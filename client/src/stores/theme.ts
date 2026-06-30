import { create } from "zustand";

type Theme = "light" | "dark" | "system";

const stored = localStorage.getItem("theme") as Theme | null;
const initial: Theme = stored ?? "system";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

interface ThemeStore {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

export const useTheme = create<ThemeStore>((set) => ({
  theme: initial,
  toggle: () =>
    set((s) => {
      const resolved = resolveTheme(s.theme);
      const next: Theme = resolved === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      return { theme: next };
    }),
  setTheme: (t: Theme) => {
    localStorage.setItem("theme", t);
    set({ theme: t });
  },
}));

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

useTheme.subscribe((s) => applyTheme(s.theme));
applyTheme(useTheme.getState().theme);

// Listen for system theme changes when in "system" mode
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (useTheme.getState().theme === "system") {
    applyTheme("system");
  }
});
