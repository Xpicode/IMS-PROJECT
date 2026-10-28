import type { FieldDB, CountDraft, TargetRec, Condition } from "./db";
import { codeVariants, normalizeCode, parseScan } from "@/lib/codes";

/** What the app tells people when the device can't store their work (A30). */
export class FieldStorageError extends Error {
  constructor(
    readonly kind: "FULL" | "UNAVAILABLE" | "UNKNOWN",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FieldStorageError";
  }
}

const MSG = {
  FULL: "Your count was NOT saved: this phone is out of storage space. Free up space (delete photos or apps), then tap Save again.",
  UNAVAILABLE:
    "Your count was NOT saved: this browser is blocking storage (private mode or storage turned off). Open IMS in a normal browser window or the installed app.",
  UNKNOWN:
    "Your count was NOT saved because of a storage problem on this phone. Try again; if it keeps failing, tell your supervisor.",
} as const;

export function toStorageError(e: unknown): FieldStorageError {
  if (e instanceof FieldStorageError) return e;
  const names = [(e as { name?: string })?.name, (e as { inner?: { name?: string } })?.inner?.name];
  const kind = names.includes("QuotaExceededError")
    ? "FULL"
    : names.some(
          (n) =>
            n &&
            [
              "MissingAPIError",
              "InvalidStateError",
              "OpenFailedError",
              "DatabaseClosedError",
              "SecurityError",
              "UnknownError",
              "InvalidAccessError",
            ].includes(n),
        )
      ? "UNAVAILABLE"
      : "UNKNOWN";
  return new FieldStorageError(kind, MSG[kind], e);
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toStorageError(e);
  }
}

/** Shape of GET /api/v1/sync/bootstrap (see lib/counts/service.ts). */
export type BootstrapPayload = {
  session: {
    id: string;
    reference: string;
    name: string;
    status: string;
    dueAt: string | Date | null;
    version: number;
    notes: string | null;
    location: { id: string; code: string; name: string };
  };
  targets: {
    id: string;
    kind: "STOCK" | "ASSET";
    version: number;
    item: { id: string; sku: string; name: string; unit: string };
    asset: { id: string; tag: string; serialNumber: string | null; status: string; condition: string } | null;
  }[];
  identifiers: { code: string; targetId: string }[];
  serverTime: string;
};

/** Save a downloaded assignment. Replaces targets and codes; never touches counts already made. */
export function saveBootstrap(db: FieldDB, b: BootstrapPayload) {
  const s = b.session;
  return guard(() =>
    db.transaction("rw", db.assignments, db.targets, db.identifiers, async () => {
      await db.targets.where("sessionId").equals(s.id).delete();
      await db.identifiers.where("[sessionId+code]").between([s.id, ""], [s.id, "\uffff"]).delete();
      await db.targets.bulkPut(
        b.targets.map((t) => ({
          id: t.id,
          sessionId: s.id,
          kind: t.kind,
          version: t.version,
          itemId: t.item.id,
          sku: t.item.sku,
          name: t.item.name,
          unit: t.item.unit,
          assetId: t.asset?.id ?? null,
          tag: t.asset?.tag ?? null,
          serialNumber: t.asset?.serialNumber ?? null,
          lastStatus: t.asset?.status ?? null,
          lastCondition: t.asset?.condition ?? null,
        })),
      );
      await db.identifiers.bulkPut(b.identifiers.map((i) => ({ sessionId: s.id, code: i.code, targetId: i.targetId })));
      await db.assignments.put({
        id: s.id,
        reference: s.reference,
        name: s.name,
        status: s.status,
        dueAt: s.dueAt ? new Date(s.dueAt).toISOString() : null,
        notes: s.notes,
        location: s.location,
        serverVersion: s.version,
        targetCount: b.targets.length,
        downloadedAt: new Date().toISOString(),
        serverTime: b.serverTime,
      });
    }),
  );
}

/** Codes to try for a scanned/typed value, in the form the server stored them. */
function lookupCodes(raw: string): string[] {
  const scan = parseScan(raw.slice(0, 200));
  if (!scan) return [];
  if (scan.kind === "ims") return [`ims:${scan.type}:${scan.id}`];
  return codeVariants(normalizeCode(scan.code));
}

/** Targets matching a code in one assignment, or in every downloaded assignment when sessionId is null. */
export async function findTargets(db: FieldDB, sessionId: string | null, raw: string): Promise<TargetRec[]> {
  const codes = lookupCodes(raw);
  if (!codes.length) return [];
  return guard(async () => {
    const hits = sessionId
      ? await db.identifiers
          .where("[sessionId+code]")
          .anyOf(codes.map((c) => [sessionId, c] as [string, string]))
          .toArray()
      : await db.identifiers.where("code").anyOf(codes).toArray();
    const ids = [...new Set(hits.map((h) => h.targetId))];
    return (await db.targets.bulkGet(ids)).filter((t): t is TargetRec => !!t);
  });
}

export const draftId = (sessionId: string, targetId: string) => `${sessionId}:${targetId}`;

export function getDraft(db: FieldDB, sessionId: string, targetId: string) {
  return guard(() => db.countDrafts.get(draftId(sessionId, targetId)));
}

export type DraftInput =
  | { sessionId: string; targetId: string; kind: "STOCK"; quantity: number; notes: string }
  | { sessionId: string; targetId: string; kind: "ASSET"; found: boolean; condition?: Condition | null; notes: string };

export class DraftValidationError extends Error {}

/**
 * Save (or replace) the count for one target. Re-counting replaces the value;
 * it never adds to it (A12). Resolves only after the write is committed and
 * read back; otherwise throws FieldStorageError, so the UI can't say "Saved"
 * for a failed save (A30).
 */
export async function saveCountDraft(db: FieldDB, input: DraftInput): Promise<CountDraft> {
  if (input.kind === "STOCK") {
    if (!Number.isInteger(input.quantity)) throw new DraftValidationError("Enter a whole number.");
    if (input.quantity < 0) throw new DraftValidationError("Enter 0 or more.");
    if (input.quantity > 1_000_000) throw new DraftValidationError("That's more than 1,000,000. Check the count.");
  } else if (input.found && !input.condition) {
    throw new DraftValidationError("Pick the condition: Good, Fair, or Damaged.");
  }
  const notes = input.notes.trim().slice(0, 1000);
  const id = draftId(input.sessionId, input.targetId);

  const saved = await guard(() =>
    db.transaction("rw", db.countDrafts, db.targets, async () => {
      const target = await db.targets.get(input.targetId);
      if (!target || target.sessionId !== input.sessionId) {
        throw new DraftValidationError(
          "That item is not part of this count. Download the assignment again if it should be.",
        );
      }
      const now = new Date().toISOString();
      const prev = await db.countDrafts.get(id);
      const rec: CountDraft = {
        id,
        sessionId: input.sessionId,
        targetId: input.targetId,
        kind: input.kind,
        quantity: input.kind === "STOCK" ? input.quantity : null,
        found: input.kind === "ASSET" ? input.found : null,
        condition: input.kind === "ASSET" && input.found ? (input.condition ?? null) : null,
        notes,
        baseVersion: target.version,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        saveCount: (prev?.saveCount ?? 0) + 1,
      };
      await db.countDrafts.put(rec);
      return rec;
    }),
  ).catch((e) => {
    if (e instanceof FieldStorageError && e.cause instanceof DraftValidationError) throw e.cause;
    throw e;
  });
  // Read back after commit: only report what is really on the device.
  const check = await guard(() => db.countDrafts.get(id));
  if (!check || check.updatedAt !== saved.updatedAt) throw new FieldStorageError("UNKNOWN", MSG.UNKNOWN);
  return check;
}

export function listDrafts(db: FieldDB, sessionId: string) {
  return guard(() => db.countDrafts.where("sessionId").equals(sessionId).toArray());
}

export async function progress(db: FieldDB, sessionId: string) {
  return guard(async () => ({
    done: await db.countDrafts.where("sessionId").equals(sessionId).count(),
    total: await db.targets.where("sessionId").equals(sessionId).count(),
  }));
}

/** Counts on this device the server hasn't acknowledged yet (all of them until sync arrives in Phase 4). */
export function pendingCount(db: FieldDB) {
  return guard(() => db.countDrafts.count());
}
