"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardList, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { StorageAlert } from "../storage-alert";
import { progress, saveBootstrap, type BootstrapPayload } from "@/lib/field/store";
import type { AssignmentRec } from "@/lib/field/db";
import { appCachedForOffline, askPersist } from "@/lib/field/device";
import { formatDateTime } from "@/lib/format";
import { fieldFetch } from "@/lib/field/net";

type Remote = {
  id: string;
  reference: string;
  name: string;
  dueAt: string | null;
  version: number;
  location: { code: string; name: string };
  targetCount: number;
};
type Card = {
  id: string;
  name: string;
  reference: string;
  location: { code: string; name: string };
  dueAt: string | null;
  local: AssignmentRec | null;
  remote: Remote | null;
  done: number;
  total: number;
};

/** Field Home / My assignments (IMS_BUILD_PLAN §4.3 wireframe). */
export function HomeView() {
  const { db, online, user, refreshPending } = useField();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [remoteOk, setRemoteOk] = useState(false);
  const [appReady, setAppReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error | null>(null);

  const fetchRemote = useCallback(async (): Promise<Remote[] | null> => {
    if (!navigator.onLine) return null;
    try {
      const r = await fieldFetch("/api/v1/counts/mine", {}, 5000);
      return r.ok ? ((await r.json()) as { data: Remote[] }).data : null;
    } catch {
      return null; // offline or the server didn't answer in time
    }
  }, []);

  const load = useCallback(
    async (remotes: Remote[] | null) => {
      const locals = await db.assignments.toArray();
      const byId = new Map<string, Card>();
      for (const l of locals) {
        const p = await progress(db, l.id);
        byId.set(l.id, {
          id: l.id,
          name: l.name,
          reference: l.reference,
          location: l.location,
          dueAt: l.dueAt,
          local: l,
          remote: null,
          ...p,
        });
      }
      for (const r of remotes ?? []) {
        const c = byId.get(r.id);
        if (c) c.remote = r;
        else
          byId.set(r.id, {
            id: r.id,
            name: r.name,
            reference: r.reference,
            location: r.location,
            dueAt: r.dueAt,
            local: null,
            remote: r,
            done: 0,
            total: r.targetCount,
          });
      }
      return {
        remoteOk: remotes !== null,
        cards: [...byId.values()].sort(
          (a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") || a.name.localeCompare(b.name),
        ),
        appReady: await appCachedForOffline(),
      };
    },
    [db],
  );

  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    setRemoteOk(r.remoteOk);
    setCards(r.cards);
    setAppReady(r.appReady);
  }, []);

  useEffect(() => {
    let alive = true;
    // Phone data first (instant, works offline), then merge the server's list.
    load(null)
      .then((r) => alive && apply(r))
      .then(fetchRemote)
      .then((remotes) => (alive && remotes ? load(remotes).then((r) => alive && apply(r)) : undefined))
      .catch((e) => alive && setError(e as Error));
    return () => {
      alive = false;
    };
  }, [load, apply, fetchRemote, online]);

  async function download(id: string) {
    setError(null);
    setBusy((b) => ({ ...b, [id]: "Downloading…" }));
    try {
      const r = await fieldFetch(`/api/v1/sync/bootstrap?sessionId=${id}`, {}, 30000);
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.message ?? "Download failed. Check your connection and try again.");
      const b = body as BootstrapPayload;
      setBusy((x) => ({ ...x, [id]: `Saving ${b.targets.length} items on this phone…` }));
      await saveBootstrap(db, b);
      await askPersist();
      // Missing on plain http (phone testing on the LAN). Not `if (navigator.serviceWorker)`:
      // Turbopack folds that to always-true at build time.
      if ("serviceWorker" in navigator)
        await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 3000))]);
      apply(await load(await fetchRemote()));
      refreshPending();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(({ [id]: _, ...rest }) => (void _, rest));
    }
  }

  const first = user.name.split(" ")[0];
  return (
    <FieldScreen title="My assignments" subtitle={`Hello, ${first}`}>
      {error && <StorageAlert error={error} />}
      {!online && (
        <p className="rounded-lg border bg-muted/50 p-3 text-[15px]">
          You&apos;re offline. You can keep counting anything already downloaded on this phone.
        </p>
      )}
      {cards === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No assignments yet"
          description={
            online
              ? "When a supervisor assigns you a count, it appears here. Download it while you have internet so you can count offline."
              : "Connect to the internet to see new assignments."
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Assignments">
          {cards.map((c) => {
            const downloaded = !!c.local;
            const gone = downloaded && remoteOk && !c.remote;
            const stale = downloaded && c.remote && c.remote.version !== c.local!.serverVersion;
            return (
              <li key={c.id} className="flex flex-col gap-2 surface p-4">
                <div>
                  <h2 className="text-lg font-semibold">{c.name}</h2>
                  <p className="text-[15px] text-muted-foreground">
                    {c.location.code} · {c.location.name}
                    {c.dueAt && <> · due {formatDateTime(c.dueAt)}</>}
                  </p>
                </div>
                {downloaded && (
                  <div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${c.total ? Math.round((c.done / c.total) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-1 text-sm tabular-nums">
                      {c.done} / {c.total} done
                    </p>
                  </div>
                )}
                {gone ? (
                  <p className="flex items-center gap-2 font-medium text-warning">
                    <AlertTriangle className="size-5" aria-hidden /> No longer open on the server. Your counts stay on
                    this phone.
                  </p>
                ) : downloaded ? (
                  appReady === false ? (
                    <p className="flex items-center gap-2 font-medium text-warning">
                      <AlertTriangle className="size-5 shrink-0" aria-hidden />
                      {process.env.NODE_ENV === "production"
                        ? "Saved on this phone. The app itself is still getting ready for offline use: keep it open with internet for a minute."
                        : "Saved on this phone. (Development mode: the offline app is turned off.)"}
                    </p>
                  ) : (
                    <p className="flex items-center gap-2 font-semibold text-success">
                      <CheckCircle2 className="size-5" aria-hidden /> Ready for offline use
                    </p>
                  )
                ) : (
                  <p className="flex items-center gap-2 font-medium text-warning">
                    <AlertTriangle className="size-5" aria-hidden /> Not downloaded
                  </p>
                )}
                {stale && online && (
                  <p className="text-sm text-muted-foreground">
                    The supervisor changed this count. Download again to get the latest list.
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {downloaded && (
                    <Button size="lg" onClick={() => go({ v: "assignment", a: c.id })}>
                      {c.done > 0 ? "Continue counting" : "Start counting"}
                    </Button>
                  )}
                  {c.remote && online && (!downloaded || stale) && (
                    <Button
                      size="lg"
                      variant={downloaded ? "outline" : "default"}
                      onClick={() => download(c.id)}
                      loading={!!busy[c.id]}
                    >
                      <Download aria-hidden />{" "}
                      {busy[c.id] ?? (downloaded ? "Download again" : "Download for offline use")}
                    </Button>
                  )}
                  {busy[c.id] && (
                    <p className="text-sm text-muted-foreground" aria-live="polite">
                      {busy[c.id]}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Button size="lg" variant="outline" onClick={() => go({ v: "borrow" })}>
        <ArrowUpRight aria-hidden /> Borrow request
      </Button>
    </FieldScreen>
  );
}
