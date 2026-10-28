"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { FieldDB } from "@/lib/field/db";
import type { FieldUser } from "@/lib/field/identity";
import { pendingCount } from "@/lib/field/store";
import { REACHABILITY_EVENT, serverReachable } from "@/lib/field/net";

type FieldCtx = {
  user: FieldUser;
  db: FieldDB;
  /** Phone has a connection AND the server answered the last request. */
  online: boolean;
  /** The server said this session is signed out; counting continues on the phone. */
  signedOut: boolean;
  pending: number | null;
  refreshPending: () => void;
};

const Ctx = createContext<FieldCtx | null>(null);

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  window.addEventListener(REACHABILITY_EVENT, cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
    window.removeEventListener(REACHABILITY_EVENT, cb);
  };
};

export function FieldProvider({
  user,
  db,
  signedOut,
  children,
}: {
  user: FieldUser;
  db: FieldDB;
  signedOut: boolean;
  children: ReactNode;
}) {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine && serverReachable(),
    () => true,
  );
  const [pending, setPending] = useState<number | null>(null);
  const refreshPending = useCallback(() => {
    pendingCount(db).then(setPending, () => setPending(null));
  }, [db]);
  useEffect(() => {
    refreshPending();
  }, [refreshPending]);
  return <Ctx.Provider value={{ user, db, online, signedOut, pending, refreshPending }}>{children}</Ctx.Provider>;
}

export function useField() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useField outside FieldProvider");
  return c;
}

export type FieldParams = { v?: string; a?: string; t?: string };

/**
 * Move between field screens without a server round trip, so it works
 * offline. Next.js keeps useSearchParams in sync with history.pushState.
 */
export function go(q: FieldParams) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  window.history.pushState(null, "", s ? `/field?${s}` : "/field");
  window.scrollTo(0, 0);
}
