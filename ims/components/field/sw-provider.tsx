"use client";

import type { ReactNode } from "react";
import { SerwistProvider } from "@serwist/turbopack/react";

/**
 * Registers the service worker in production builds only. Never reloads the
 * page by itself (reloadOnOnline off) so a count is never interrupted.
 */
export function ServiceWorkerProvider({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV !== "production"}
      reloadOnOnline={false}
      cacheOnNavigation={false}
    >
      {children}
    </SerwistProvider>
  );
}
