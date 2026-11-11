import { useEffect, useState } from "react";

// Light / dark. Sets data-theme on <html> only; the shared stylesheet's tokens do the rest. Remembered per browser.
const KEY = "privilege-owasp-lab.theme";
function initialTheme() {
  try { const t = localStorage.getItem(KEY); if (t === "dark" || t === "light") return t; } catch { /* blocked */ }
  try { return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch { return "light"; }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* blocked */ }
  }, [theme]);
  const dark = theme === "dark";
  return (
    <button type="button" aria-pressed={dark} data-testid="theme-toggle" title="Switch between light and dark" onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? "Dark" : "Light"}
    </button>
  );
}
