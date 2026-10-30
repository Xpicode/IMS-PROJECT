import type { BorrowDraftRec, FieldDB } from "./db";
import { normalizeCode } from "@/lib/codes";
import { newId } from "@/lib/utils";
import { UNAVAILABLE_REASON } from "@/lib/assets/labels";
import type { AssetStatus } from "@/lib/assets/transitions";

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
    id: newId(),
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

export type AssetHit = { id: string; tag: string; status: AssetStatus; item: { name: string } };

/** Assets at the request's location whose tag, serial or item matches `q` (online only). */
export async function findAssets(fetchFn: Fetch, locationId: string, q: string): Promise<AssetHit[]> {
  const r = await fetchFn(`/api/v1/assets?locationId=${locationId}&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()) as { rows: AssetHit[] }).rows;
}

/**
 * Online check of a typed tag before it goes on a request: null = OK, else what's wrong.
 * No answer from the server → null; the supervisor still checks everything on release.
 */
export async function checkBorrowTag(fetchFn: Fetch, loc: { id: string; code: string }, tag: string) {
  let rows: AssetHit[];
  try {
    rows = await findAssets(fetchFn, loc.id, tag);
  } catch {
    return null;
  }
  const a = rows.find((x) => x.tag === tag);
  if (!a) return `No asset ${tag} at ${loc.code}. Check the tag, or pick the right location.`;
  if (a.status !== "AVAILABLE") return `${tag} can't be borrowed. ${UNAVAILABLE_REASON[a.status]}`;
  return null;
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
