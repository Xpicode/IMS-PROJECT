"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HardDrive, LogOut, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { InstallHelp } from "../install-help";
import { AppearanceChoice } from "@/components/common/theme-controls";
import { appCachedForOffline, askPersist, formatBytes, storageStatus, type StorageStatus } from "@/lib/field/device";
import { forgetUser } from "@/lib/field/identity";

const ROLE = { ADMIN: "Administrator", SUPERVISOR: "Supervisor", FIELD: "Field staff" } as const;

/** Me: profile, storage status (§10.5), install help, sign out with a pending-data warning. */
export function MeView() {
  const { user, pending, online } = useField();
  const [st, setSt] = useState<StorageStatus | null>(null);
  const [offlineApp, setOfflineApp] = useState<boolean | null>(null);
  const [help, setHelp] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    storageStatus().then(setSt, () => undefined);
    appCachedForOffline().then(setOfflineApp, () => setOfflineApp(false));
  }, []);

  async function protect() {
    const r = await askPersist();
    setSt(await storageStatus());
    setMsg(
      r
        ? "Done. The browser will keep your data even when the phone is low on space."
        : "The browser said no. Install the app (see below) and try again; your data is still saved, just less protected.",
    );
  }

  async function signOut() {
    if (!navigator.onLine) throw new Error("Signing out needs internet. Your counts stay on this phone either way.");
    const r = await fetch("/api/v1/auth/csrf", { cache: "no-store" });
    const { csrfToken } = (await r.json()) as { csrfToken: string };
    await fetch("/api/v1/auth/signout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: "/login" }),
    });
    forgetUser();
    // Full page load on purpose: drop every bit of the signed-out user's state from memory.
    window.location.replace("/login");
  }

  const pct = st?.usage != null && st.quota ? Math.min(100, Math.round((st.usage / st.quota) * 100)) : null;
  return (
    <FieldScreen title="Me" back={() => go({})}>
      <section className="rounded-xl border bg-card p-4">
        <p className="text-xl font-semibold">{user.name}</p>
        <p className="text-muted-foreground">{ROLE[user.role]}</p>
        {user.role !== "FIELD" && (
          <Link href="/" className="mt-2 inline-block font-medium text-primary underline-offset-4 hover:underline">
            Open the office app
          </Link>
        )}
      </section>

      <section aria-labelledby="st-h" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <h2 id="st-h" className="flex items-center gap-2 text-lg font-semibold">
          <HardDrive className="size-5" aria-hidden /> Storage on this phone
        </h2>
        {!st ? (
          <p>Checking…</p>
        ) : !st.supported ? (
          <p className="font-medium text-danger">
            This browser doesn&apos;t report storage. Counting may not work here. Use Chrome (Android) or Safari
            (iPhone).
          </p>
        ) : (
          <>
            <p>
              Using <b>{formatBytes(st.usage)}</b> of about {formatBytes(st.quota)}
              {pct !== null && ` (${pct}%)`}.
            </p>
            {pct !== null && pct >= 90 && (
              <p className="font-semibold text-danger">
                Almost full. Free up space before counting, or saves may fail.
              </p>
            )}
            <p>
              Protected from automatic clean-up:{" "}
              <b className={st.persisted ? "text-success" : "text-warning"}>
                {st.persisted ? "Yes" : st.persisted === false ? "No" : "Unknown"}
              </b>
            </p>
            {!st.persisted && (
              <Button variant="outline" onClick={protect}>
                Keep my data safe
              </Button>
            )}
          </>
        )}
        <p>
          App works offline:{" "}
          <b className={offlineApp ? "text-success" : "text-warning"}>
            {offlineApp === null ? "Checking…" : offlineApp ? "Yes" : "Not yet"}
          </b>
        </p>
        {msg && (
          <p role="status" className="text-[15px]">
            {msg}
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <AppearanceChoice />
      </section>

      <Button size="lg" variant="outline" onClick={() => setHelp(true)}>
        <Smartphone aria-hidden /> Install IMS on this phone
      </Button>
      <Button size="lg" variant="outline" onClick={() => setConfirm(true)} disabled={!online}>
        <LogOut aria-hidden /> Sign out
      </Button>
      {!online && <p className="text-sm text-muted-foreground">Signing out needs internet.</p>}

      <InstallHelp open={help} onOpenChange={setHelp} />
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title="Sign out?"
        description={
          (pending ?? 0) > 0
            ? `You have ${pending} counts on this phone that are not sent yet. They stay on this phone and come back when ${user.name.split(" ")[0]} signs in again here. Don't clear browser data.`
            : "You can sign in again any time."
        }
        confirmLabel="Sign out"
        tone={(pending ?? 0) > 0 ? "destructive" : "default"}
        onConfirm={signOut}
      />
    </FieldScreen>
  );
}
