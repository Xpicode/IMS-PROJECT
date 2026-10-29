import type { BorrowDraftRec, FieldDB } from "./db";
import { normalizeCode } from "@/lib/codes";

/**
 * Borrowing requests prepared on the phone (spec §7.5 step 1, BUILD_PLAN Phase 5).
 * Saved locally as "Draft on this device – not official"; Send turns it into a
 * DRAFT loan on the server that a supervisor checks and releases. The draft id
 * is the Idempotency-Key, so sending again after a lost reply never makes two.
 */
export type BorrowDraftInput = {
  id?: string;
  location: BorrowDraftRec["location"];
  borrowerName: string;
  borrowerDept: string;
  purpose: string;
  tags: string[];
  assetIds?: { id: string; label: string }[];
  notes: string;
};
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function saveBorrowDraft(db: FieldDB, input: BorrowDraftInput): Promise<BorrowDraftRec> {
  const tags = [...new Set(input.tags.map((t) => normalizeCode(t)).filter(Boolean))];
  if (!input.borrowerName.trim()) throw new Error("Enter who is borrowing it.");
  if (!input.purpose.trim()) throw new Error("Enter what it's for.");
  const assetIds = [...new Map((input.assetIds ?? []).map((a) => [a.id, a])).values()];
  if (!tags.length && !assetIds.length) throw new Error("Add at least one asset tag.");
  const now = new Date().toISOString();
  const old = input.id ? await db.borrowDrafts.get(input.id) : undefined;
  if (old && (old.status === "SENT" || old.status === "SENDING")) throw new Error("This request was already sent.");
  const rec: BorrowDraftRec = {
    // A changed request is a new request: new id, so a new Idempotency-Key.
    id: crypto.randomUUID(),
    location: input.location,
    borrowerName: input.borrowerName.trim(),
    borrowerDept: input.borrowerDept.trim(),
    purpose: input.purpose.trim(),
    tags,
    ...(assetIds.length ? { assetIds } : {}),
    notes: input.notes.trim(),
    status: "DRAFT",
    attempts: 0,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
  };
  await db.transaction("rw", db.borrowDrafts, async () => {
    if (old) await db.borrowDrafts.delete(old.id);
    await db.borrowDrafts.put(rec);
  });
  return rec;
}

export const listBorrowDrafts = (db: FieldDB) => db.borrowDrafts.orderBy("updatedAt").reverse().toArray();

export async function removeBorrowDraft(db: FieldDB, id: string) {
  await db.borrowDrafts.delete(id);
}

export async function sendBorrowDraft(db: FieldDB, id: string, fetchFn: Fetch): Promise<BorrowDraftRec> {
  const d = await db.borrowDrafts.get(id);
  if (!d) throw new Error("That request is no longer on this phone.");
  if (d.status === "SENT") return d;
  await db.borrowDrafts.update(id, { status: "SENDING" });
  const body = {
    locationId: d.location.id,
    borrowerName: d.borrowerName,
    ...(d.borrowerDept ? { borrowerDept: d.borrowerDept } : {}),
    purpose: d.purpose,
    assetTags: d.tags,
    ...(d.assetIds?.length ? { assetIds: d.assetIds.map((a) => a.id) } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
  };
  let patch: Partial<BorrowDraftRec>;
  try {
    const r = await fetchFn("/api/v1/borrowings", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": d.id },
      body: JSON.stringify(body),
    });
    const res = (await r.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (r.ok && res?.id) patch = { status: "SENT", serverId: res.id, error: undefined };
    else if (r.status === 401) patch = { status: "FAILED", error: "Sign in again, then send." };
    else if (r.status >= 500 || r.status === 429)
      patch = { status: "FAILED", error: "The server is busy. Try again in a minute." };
    else patch = { status: "REJECTED", error: res?.message ?? "The server did not accept this request." };
  } catch {
    patch = { status: "FAILED", error: "No connection. It's saved on this phone; send it when you're online." };
  }
  await db.borrowDrafts.update(id, { ...patch, attempts: d.attempts + 1, updatedAt: new Date().toISOString() });
  return (await db.borrowDrafts.get(id))!;
}
