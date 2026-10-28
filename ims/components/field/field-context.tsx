"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { FieldDB } from "@/lib/field/db";
import { whoAmI, type FieldUser } from "@/lib/field/identity";
import { REACHABILITY_EVENT, serverReachable } from "@/lib/field/net";
import { submitDrafts, syncNow, syncSummary, type SyncOutcome, type SyncSummary } from "@/lib/field/outbox";
import { refreshAssignments } from "@/lib/field/refresh";

/** Auto-retry while the app is open and online (§10.6): queued counts only, never unsent drafts. */
const RETRY_MS = 30_000;

type FieldCtx = {
  user: FieldUser;
  db: FieldDB;
  /** Phone has a connection AND the server answered the last request. */
  online: boolean;
  /** The server said this session is signed out; counting continues on the phone. */
  signedOut: boolean;
  /** Counts on this phone not yet received by the server (drafts + queued). */
  pending: number | null;
  summary: SyncSummary | null;
  refreshPending: () => void;
  syncing: boolean;
  lastSync: SyncOutcome | null;
  /** Send whatever is queued now (Sync now). One run at a time. */
  runSync: () => Promise<SyncOutcome | null>;
  /** Queue every new/changed count in an assignment, then send. */
  sendCounts: (sessionId: string) => Promise<{ queued: number; outcome: SyncOutcome | null }>;
  /** Bumped after each sync/refresh so screens re-read the phone's data. */
  dataVersion: number;
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
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncOutcome | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const running = useRef<Promise<SyncOutcome | null> | null>(null);

  const refreshPending = useCallback(() => {
    syncSummary(db).then(setSummary, () => setSummary(null));
  }, [db]);
  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  const runSync = useCallback(() => {
    if (running.current) return running.current;
    const job = (async () => {
      setSyncing(true);
      try {
        const outcome = await syncNow(db, { userId: user.id, fetch: (...a) => fetch(...a), whoAmI: () => whoAmI() });
        if (outcome.state !== "nothing") setLastSync(outcome);
        // After a send, or a Sync now with nothing to send: download open assignments again
        // (simple pull, §11.3) so closed counts and recount requests show up.
        if (outcome.state === "done" || (outcome.state === "nothing" && navigator.onLine)) {
          if (await refreshAssignments(db, (...a) => fetch(...a))) setDataVersion((v) => v + 1);
        }
        return outcome;
      } catch {
        return null; // storage problem: the sync screen shows the storage message on its next read
      } finally {
        setSyncing(false);
        running.current = null;
        refreshPending();
        setDataVersion((v) => v + 1);
      }
    })();
    running.current = job;
    return job;
  }, [db, user.id, refreshPending]);

  const sendCounts = useCallback(
    async (sessionId: string) => {
      const queued = await submitDrafts(db, user.id, sessionId);
      refreshPending();
      return { queued, outcome: await runSync() };
    },
    [db, user.id, refreshPending, runSync],
  );

  // Retry queued counts while open: when the connection returns, and every 30 s.
  const queued = summary?.queued ?? 0;
  useEffect(() => {
    if (!online || queued === 0) return;
    const t = window.setInterval(() => void runSync(), RETRY_MS);
    const kick = window.setTimeout(() => void runSync(), 1500);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(kick);
    };
  }, [online, queued, runSync]);

  return (
    <Ctx.Provider
      value={{
        user,
        db,
        online,
        signedOut,
        pending: summary ? summary.notSent : null,
        summary,
        refreshPending,
        syncing,
        lastSync,
        runSync,
        sendCounts,
        dataVersion,
      }}
    >
      {children}
    </Ctx.Provider>
  );
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
