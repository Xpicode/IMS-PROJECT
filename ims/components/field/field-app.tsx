"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertOctagon, WifiOff } from "lucide-react";
import { FieldProvider } from "./field-context";
import { FieldNav } from "./field-shell";
import { HomeView } from "./views/home-view";
import { AssignmentView } from "./views/assignment-view";
import { ScanView } from "./views/scan-view";
import { CountView } from "./views/count-view";
import { ResultsView } from "./views/results-view";
import { SyncView } from "./views/sync-view";
import { MeView } from "./views/me-view";
import { BorrowView } from "./views/borrow-view";
import { makeFieldDB, type FieldDB } from "@/lib/field/db";
import { rememberUser, storedUser, whoAmI, type FieldUser } from "@/lib/field/identity";
import { toStorageError, type FieldStorageError } from "@/lib/field/store";
import { newId } from "@/lib/utils";

type Boot =
  | { state: "loading" }
  | { state: "need-signin" }
  | { state: "storage-error"; error: FieldStorageError }
  | { state: "ready"; user: FieldUser; db: FieldDB; signedOut: boolean };

async function openDb(user: FieldUser) {
  const db = makeFieldDB(user.id);
  await db.open();
  const meta = await db.syncMeta.get("meta");
  if (!meta) await db.syncMeta.put({ id: "meta", userId: user.id, deviceId: newId(), schemaVersion: 1 });
  return db;
}

/**
 * The field app: a client-rendered single page (/field) that reads assigned
 * data from IndexedDB, so it works offline (spec §10.4). Screens are chosen
 * by ?v=…&a=…&t=… and switched with history.pushState (no server round trip).
 */
export function FieldApp() {
  const sp = useSearchParams();
  const [boot, setBoot] = useState<Boot>({ state: "loading" });

  useEffect(() => {
    let alive = true;
    const ready = async (user: FieldUser, signedOut = false) => {
      try {
        const db = await openDb(user);
        if (alive) setBoot({ state: "ready", user, db, signedOut });
      } catch (e) {
        if (alive) setBoot({ state: "storage-error", error: toStorageError(e) });
      }
    };
    (async () => {
      // Offline-first: if this phone knows who is counting, open their data now
      // and check with the server in the background (never wait on the network).
      const known = storedUser();
      if (known) void ready(known);
      const who = await whoAmI();
      if (!alive) return;
      if (who.state === "online") {
        rememberUser(who.user);
        if (!known) void ready(who.user);
        // Someone else signed in on this phone: switch to their own database.
        else if (who.user.id !== known.id) window.location.reload();
      } else if (who.state === "signed-out") {
        // Keep counting on the phone; they must sign in again before sending (Phase 4).
        if (known) setBoot((b) => (b.state === "ready" ? { ...b, signedOut: true } : b));
        else window.location.replace("/login?next=%2Ffield");
      } else if (!known) {
        setBoot({ state: "need-signin" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (boot.state === "loading") return <p className="p-6 text-lg">Opening IMS…</p>;
  if (boot.state === "need-signin")
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
        <WifiOff className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-2xl font-semibold">Sign in once with internet</h1>
        <p>
          This phone hasn&apos;t been set up for offline counting yet. Connect to the internet, sign in, and download
          your assignment.
        </p>
        <a
          href="/login?next=%2Ffield"
          className="flex h-14 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground"
        >
          Sign in
        </a>
      </main>
    );
  if (boot.state === "storage-error")
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-6" role="alert">
        <AlertOctagon className="size-10 text-danger" aria-hidden />
        <h1 className="text-2xl font-semibold text-danger">This phone can&apos;t save counts here</h1>
        <p className="text-lg">{boot.error.message.replace("Your count was NOT saved: ", "")}</p>
        <p>Nothing you enter here would be kept, so counting is turned off.</p>
      </main>
    );

  const v = sp.get("v") ?? "";
  const a = sp.get("a") ?? undefined;
  const t = sp.get("t") ?? undefined;
  let view = <HomeView />;
  if (v === "assignment" && a) view = <AssignmentView id={a} />;
  else if (v === "scan") view = <ScanView key={`${a}-${t}`} assignment={a} startTyping={t === "type"} />;
  else if (v === "count" && a && t) view = <CountView key={t} assignment={a} target={t} />;
  else if (v === "results" && a) view = <ResultsView assignment={a} />;
  else if (v === "sync") view = <SyncView />;
  else if (v === "me") view = <MeView />;
  else if (v === "borrow") view = <BorrowView />;

  return (
    <FieldProvider user={boot.user} db={boot.db} signedOut={boot.signedOut}>
      <div className="flex min-h-dvh flex-col bg-background">
        {view}
        {v !== "count" && <FieldNav view={v} assignment={a} />}
      </div>
    </FieldProvider>
  );
}
