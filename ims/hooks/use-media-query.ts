"use client";

import { useSyncExternalStore } from "react";

/** True when the media query matches. Server render assumes `serverDefault`. */
export function useMediaQuery(query: string, serverDefault = false) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}

/** Desktop/tablet (>= 768px) vs phone, matching the plan's breakpoints (§2.2). */
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)", true);
