"use server";

import { signOut } from "@/lib/auth/auth";

// shortcut: no pending-data check yet; the "you have unsent counts" warning arrives with the outbox (Phase 4).
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
