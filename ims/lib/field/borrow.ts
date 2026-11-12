import type { BorrowDraftRec, BorrowLineRec, FieldDB } from "./db";
import { normalizeCode } from "@/lib/codes";
import { newId } from "@/lib/utils";

/**
 * Borrowing requests prepared on the phone (spec §7.5 step 1).
 * Saved locally as "Draft on this device – not official"; Send turns it into a
 * DRAFT loan on the server that a supervisor checks and releases (stock goes
 * down only then). The draft id is the Idempotency-Key, so sending again after
 * a lost reply never makes two.
 */
export type BorrowDraftInput = {
  id?: string;
  location: BorrowDraftRec["location"];
  borrowerName: string;
  borrowerDept: string;
  purpose: string;
  lines: BorrowLineRec[];
  notes: string;
};
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Same item twice (picked once, scanned once): one line, quantities added. */
const lineKey = (l: BorrowLineRec) => l.itemId ?? `code:${normalizeCode(l.code ?? "")}`;
export function mergeLines(lines: BorrowLineRec[]): BorrowLineRec[] {
  const out = new Map<string, BorrowLineRec>();
  for (const l of lines) {
    const k = lineKey(l);
    const had = out.get(k);
    out.set(k, had ? { ...had, quantity: had.quantity + l.quantity } : l);
  }
  return [...out.values()];
}

export async function saveBorrowDraft(db: FieldDB, input: BorrowDraftInput): Promise<BorrowDraftRec> {
  if (!input.borrowerName.trim()) throw new Error("Enter who is borrowing it.");
  if (!input.purpose.trim()) throw new Error("Enter what it's for.");
  const lines = mergeLines(input.lines);
  if (!lines.length) throw new Error("Add at least one item.");
  if (lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1))
    throw new Error("Each item needs a quantity of 1 or more.");
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
    lines,
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

export type ItemHit = { id: string; sku: string; name: string; unitCode: string; onHand: number };

/** Items whose SKU, name or barcode matches `q` (online only), with what is on hand at my locations. */
export async function findItems(fetchFn: Fetch, q: string): Promise<ItemHit[]> {
  const r = await fetchFn(`/api/v1/items?q=${encodeURIComponent(q)}&pageSize=8`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()) as { rows: ItemHit[] }).rows;
}

export const listBorrowDrafts = (db: FieldDB) => db.borrowDrafts.orderBy("updatedAt").reverse().toArray();

export async function removeBorrowDraft(db: FieldDB, id: string) {
  await db.borrowDrafts.delete(id);
}

/** "3 × Drill, 2 × Gloves" for lists. Requests saved before items had quantities have no lines. */
export const describeLines = (d: BorrowDraftRec) =>
  (d.lines ?? []).map((l) => `${l.quantity} × ${l.label}`).join(", ") || "Old request: open it and add the items";

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
    lines: (d.lines ?? []).map((l) =>
      l.itemId ? { itemId: l.itemId, quantity: l.quantity } : { code: l.code, quantity: l.quantity },
    ),
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
