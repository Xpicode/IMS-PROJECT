import type { CountDraft, FieldDB, OutboxOperation, OutboxResult, OutboxStatus } from "./db";
import { FieldStorageError, toStorageError } from "./store";
import type { whoAmI } from "./identity";

/**
 * Sending counts from the phone (spec §11.1–11.2, §10.5).
 *
 * - "Send counts" freezes every new or changed count into an outbox operation
 *   with a UUID made once here. Its payload never changes afterwards; editing
 *   a count later makes a new operation.
 * - "Sync now" sends PENDING / SENDING / FAILED operations in order, at most 50
 *   per request, reusing their original IDs, so a lost response can't create a
 *   duplicate (A16). Only an ACKED answer marks a count as received (A15).
 * - Nothing is sent unless the signed-in server user owns this outbox.
 */
export const BATCH = 50;
const SENDABLE: OutboxStatus[] = ["PENDING", "SENDING", "FAILED"];

let lastSeq = 0;
const nextSeq = () => (lastSeq = Math.max(Date.now() * 1000, lastSeq + 1));

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toStorageError(e);
  }
}

/** Latest operation made from each draft. */
async function latestByDraft(db: FieldDB, sessionId?: string) {
  const ops = sessionId ? await db.outbox.where("sessionId").equals(sessionId).toArray() : await db.outbox.toArray();
  const m = new Map<string, OutboxOperation>();
  for (const o of ops.sort((a, b) => a.seq - b.seq)) m.set(o.draftId, o);
  return m;
}

function freeze(userId: string, d: CountDraft): OutboxOperation {
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    operationId,
    userId,
    sessionId: d.sessionId,
    targetId: d.targetId,
    draftId: d.id,
    draftSaveCount: d.saveCount,
    type: "SUBMIT_COUNT",
    baseVersion: d.baseVersion,
    payload: {
      operationId,
      type: "SUBMIT_COUNT",
      sessionId: d.sessionId,
      targetId: d.targetId,
      baseVersion: d.baseVersion,
      clientRecordedAt: d.updatedAt,
      payload:
        d.kind === "STOCK"
          ? { quantity: d.quantity, notes: d.notes }
          : { found: d.found, condition: d.found ? d.condition : null, notes: d.notes },
    },
    status: "PENDING",
    attempts: 0,
    createdAt: now,
    seq: nextSeq(),
  };
}

/** "Send counts": queue every count in this assignment that is new or changed since it was last queued. */
export function submitDrafts(db: FieldDB, userId: string, sessionId: string): Promise<number> {
  return guard(() =>
    db.transaction("rw", db.countDrafts, db.outbox, async () => {
      const drafts = await db.countDrafts.where("sessionId").equals(sessionId).toArray();
      const latest = await latestByDraft(db, sessionId);
      const fresh = drafts.filter((d) => latest.get(d.id)?.draftSaveCount !== d.saveCount);
      await db.outbox.bulkAdd(fresh.map((d) => freeze(userId, d)));
      return fresh.length;
    }),
  );
}

/** Deliberately re-send a count the server refused or flagged, as a new operation. */
export function sendAgain(db: FieldDB, userId: string, operationId: string) {
  return guard(() =>
    db.transaction("rw", db.countDrafts, db.outbox, async () => {
      const op = await db.outbox.get(operationId);
      const d = op && (await db.countDrafts.get(op.draftId));
      if (!d) throw new FieldStorageError("UNKNOWN", "That count is no longer on this phone.");
      await db.outbox.add(freeze(userId, d));
    }),
  );
}

export type DraftSyncState = "DRAFT" | OutboxStatus;

/** State of every count on this phone: DRAFT = changed since it was last queued. */
export async function draftStates(db: FieldDB, sessionId?: string) {
  return guard(async () => {
    const drafts = sessionId
      ? await db.countDrafts.where("sessionId").equals(sessionId).toArray()
      : await db.countDrafts.toArray();
    const latest = await latestByDraft(db, sessionId);
    return new Map(
      drafts.map((d) => {
        const op = latest.get(d.id);
        const state: DraftSyncState = !op || op.draftSaveCount !== d.saveCount ? "DRAFT" : op.status;
        return [d.id, { draft: d, op: op && op.draftSaveCount === d.saveCount ? op : undefined, state }];
      }),
    );
  });
}

export type SyncSummary = { draft: number; queued: number; notSent: number; received: number; attention: number };

export async function syncSummary(db: FieldDB, sessionId?: string): Promise<SyncSummary> {
  const s: SyncSummary = { draft: 0, queued: 0, notSent: 0, received: 0, attention: 0 };
  for (const { state } of (await draftStates(db, sessionId)).values()) {
    if (state === "DRAFT") s.draft++;
    else if (SENDABLE.includes(state)) s.queued++;
    else if (state === "ACKED") s.received++;
    else s.attention++;
  }
  s.notSent = s.draft + s.queued;
  return s;
}

export type SyncDeps = {
  userId: string;
  fetch: typeof fetch;
  whoAmI: () => ReturnType<typeof whoAmI>;
};

export type SyncOutcome = {
  state: "done" | "nothing" | "failed" | "offline" | "signed-out" | "wrong-user";
  acked: number;
  conflicts: number;
  rejected: number;
  failed: number;
  message?: string;
};

type ServerResult = { operationId: string | null; status: string } & Partial<OutboxResult>;

const UNREACHABLE =
  "Couldn't reach the server. Your counts are safe on this phone; they'll be sent when the connection is back.";

/** Send everything waiting in the outbox. Never throws for network problems; storage errors do throw. */
export async function syncNow(db: FieldDB, deps: SyncDeps): Promise<SyncOutcome> {
  const out: SyncOutcome = { state: "nothing", acked: 0, conflicts: 0, rejected: 0, failed: 0 };
  const queue = await guard(async () =>
    (await db.outbox.where("status").anyOf(SENDABLE).toArray())
      .filter((o) => o.userId === deps.userId)
      .sort((a, b) => a.seq - b.seq),
  );
  if (!queue.length) return out;

  const who = await deps.whoAmI();
  if (who.state === "offline") return { ...out, state: "offline", message: UNREACHABLE };
  if (who.state === "signed-out")
    return { ...out, state: "signed-out", message: "Sign in again to send your counts. They stay on this phone." };
  if (who.user.id !== deps.userId)
    return {
      ...out,
      state: "wrong-user",
      message: "Someone else is signed in on this phone. These counts can only be sent by the person who made them.",
    };

  const meta = await guard(() => db.syncMeta.get("meta"));
  const deviceId = meta?.deviceId ?? "unknown";
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    const ids = batch.map((o) => o.operationId);
    const sentAt = new Date().toISOString();
    await guard(() =>
      db.transaction("rw", db.outbox, async () => {
        for (const o of batch)
          await db.outbox.update(o.operationId, { status: "SENDING", attempts: o.attempts + 1, sentAt });
      }),
    );
    let results: ServerResult[] | null = null;
    let error = UNREACHABLE;
    try {
      const res = await deps.fetch("/api/v1/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId, operations: batch.map((o) => o.payload) }),
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) results = ((await res.json()) as { results: ServerResult[] }).results;
      else if (res.status === 401) error = "You're signed out. Sign in again to send your counts.";
      else error = `The server answered with an error (${res.status}). Your counts are safe on this phone.`;
    } catch {
      /* no answer: the server may or may not have saved them; the same IDs make the retry safe */
    }
    if (!results) {
      await guard(() => db.outbox.where("operationId").anyOf(ids).modify({ status: "FAILED", lastError: error }));
      out.failed += batch.length;
      out.state = "failed";
      out.message = error;
      return out;
    }
    await guard(() =>
      db.transaction("rw", db.outbox, async () => {
        for (const [k, o] of batch.entries()) {
          const r = results!.find((x) => x.operationId === o.operationId) ?? results![k];
          const result: OutboxResult = {
            code: r?.code ?? "UNKNOWN",
            message: r?.message ?? "",
            nextAction: r?.nextAction ?? "",
            serverVersion: r?.serverVersion,
          };
          if (r?.status === "ACKED") {
            await db.outbox.update(o.operationId, {
              status: "ACKED",
              ackedAt: new Date().toISOString(),
              lastError: undefined,
            });
            out.acked++;
          } else if (r?.status === "CONFLICT" || r?.status === "REJECTED") {
            await db.outbox.update(o.operationId, { status: r.status, result, lastError: undefined });
            if (r.status === "CONFLICT") out.conflicts++;
            else out.rejected++;
          } else {
            await db.outbox.update(o.operationId, {
              status: "FAILED",
              lastError: result.message || "The server couldn't save this count yet.",
            });
            out.failed++;
          }
        }
      }),
    );
  }
  await guard(() => db.syncMeta.update("meta", { lastSyncAt: new Date().toISOString() }));
  out.state = "done";
  return out;
}
