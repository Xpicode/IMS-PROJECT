"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyTheme, readTheme, THEME_EVENT, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Current choice + whether the page is dark right now; follows the device while on "system". */
function useTheme() {
  const [state, setState] = useState<{ choice: ThemeChoice; dark: boolean } | null>(null);
  useEffect(() => {
    const sync = () => setState({ choice: readTheme(), dark: document.documentElement.classList.contains("dark") });
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onDevice = () => {
      if (readTheme() === "system") applyTheme("system");
    };
    sync();
    window.addEventListener(THEME_EVENT, sync);
    media.addEventListener("change", onDevice);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      media.removeEventListener("change", onDevice);
    };
  }, []);
  return state;
}

/** One tap between light and dark, for the top bars. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTheme();
  const dark = t?.dark ?? false;
  return (
    <button
      type="button"
      onClick={() => applyTheme(dark ? "light" : "dark")}
      aria-pressed={t ? dark : undefined}
      className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted", className)}
    >
      {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
      <span className="sr-only">Dark mode</span>
    </button>
  );
}

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Same as device", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Full choice, including going back to following the device (Me pages). */
export function AppearanceChoice() {
  const t = useTheme();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-lg font-semibold">Appearance</legend>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center text-sm font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              t?.choice === value ? "border-primary bg-accent text-foreground" : "hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name="appearance"
              value={value}
              checked={t?.choice === value}
              onChange={() => applyTheme(value)}
              className="sr-only"
            />
            <Icon className="size-5" aria-hidden />
            {label}
          </label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Saved on this device only.</p>
    </fieldset>
  );
}
