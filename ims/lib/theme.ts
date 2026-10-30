/**
 * Light / dark / follow-the-device. The choice lives in localStorage (per device,
 * like the rest of the field app's local settings); "system" = no entry.
 * The `.dark` class on <html> switches the tokens in globals.css.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "ims-theme";
export const THEME_EVENT = "ims-theme";

/** Inline in <head>, before first paint, so a dark-mode page never flashes white. Mirrors applyTheme. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage blocked (private mode): the choice still applies until the page reloads.
  }
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  window.dispatchEvent(new Event(THEME_EVENT));
}
