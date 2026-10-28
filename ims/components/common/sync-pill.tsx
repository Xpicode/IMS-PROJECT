"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { CloudUpload, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "./status-chip";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/**
 * Always in the top bar; tap to open the Sync screen (IMS_BUILD_PLAN §3.5).
 * shortcut: shows connection only; the pending count arrives with the Dexie outbox in Phase 4.
 * It never says "Synced": that word waits for a real server acknowledgment.
 */
export function SyncPill() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const Icon = online ? CloudUpload : WifiOff;
  return (
    <Link
      href="/sync"
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap",
        TONE_CLASSES[online ? "success" : "danger"],
      )}
      aria-label={online ? "Online. Nothing waiting to send. Open sync" : "Offline. Open sync"}
    >
      <Icon className="size-4" aria-hidden />
      {online ? "Online" : "Offline"}
    </Link>
  );
}
