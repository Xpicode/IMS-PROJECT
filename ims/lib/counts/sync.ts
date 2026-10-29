import "server-only";
import { z } from "zod";
import { prisma, Prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { sha256, stableStringify } from "@/lib/crypto";
import type { Ctx } from "@/lib/context";

/**
 * Device → server count upload (spec §11.1–11.4).
 *
 * Every operation is handled on its own, in its own transaction, in the order
 * sent. The outcome is stored under (user, operationId) in the same
 * transaction as the count, so a retry after a lost response gets the stored
 * answer instead of a second count (A16). Unexpected errors are not stored:
 * the device retries them with the same ID (RETRYABLE_ERROR).
 */
export const MAX_OPS = 50;

const UUID = z.string().uuid();
const condition = z.enum(["GOOD", "FAIR", "DAMAGED"]);

const opSchema = z.object({
  operationId: UUID,
  type: z.literal("SUBMIT_COUNT"),
  sessionId: UUID,
  targetId: UUID,
  baseVersion: z.number().int().min(1),
  clientRecordedAt: z.string().datetime({ offset: true }).optional().nullable(),
  payload: z
    .object({
      quantity: z.number().int().min(0).max(1_000_000).optional().nullable(),
      found: z.boolean().optional().nullable(),
      condition: condition.optional().nullable(),
      notes: z.string().max(1000).optional().nullable(),
    })
    .strict(),
});

export type PushOperation = z.input<typeof opSchema>;
type Op = z.output<typeof opSchema>;

export type PushResult =
  | { operationId: string; status: "ACKED"; serverRecordId: string; serverVersion: number }
  | {
      operationId: string | null;
      status: "CONFLICT" | "REJECTED" | "RETRYABLE_ERROR";
      code: string;
      message: string;
      nextAction: string;
      serverVersion?: number;
    };

const pushSchema = z.object({
  deviceId: z.string().trim().min(1).max(64),
  operations: z.array(z.unknown()).min(1).max(MAX_OPS, `Send at most ${MAX_OPS} counts at a time.`),
});

const KEEP = "Your count is kept on this phone.";

function rejected(operationId: string | null, code: string, message: string, nextAction: string): PushResult {
  return { operationId, status: "REJECTED", code, message, nextAction };
}

/** Everything that identifies "the same operation" (the device ID may change after a reinstall). */
const hashOf = (op: Op) =>
  sha256(
    stableStringify({
      type: op.type,
      sessionId: op.sessionId,
      targetId: op.targetId,
      baseVersion: op.baseVersion,
      clientRecordedAt: op.clientRecordedAt ?? null,
      payload: {
        quantity: op.payload.quantity ?? null,
        found: op.payload.found ?? null,
        condition: op.payload.condition ?? null,
        notes: op.payload.notes ?? "",
      },
    }),
  );

export async function pushOperations(actor: AccessUser, input: unknown, ctx: Ctx) {
  if (actor.status !== "ACTIVE") throw errors.inactive();
  const parsed = pushSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "The upload is not valid.");
  }
  const { deviceId, operations } = parsed.data;
  const results: PushResult[] = [];
  for (const raw of operations) results.push(await processOne(actor, deviceId, raw, ctx));
  return { results, serverTime: new Date().toISOString() };
}

async function processOne(actor: AccessUser, deviceId: string, raw: unknown, ctx: Ctx): Promise<PushResult> {
  const parsed = opSchema.safeParse(raw);
  const rawId = (raw as { operationId?: unknown } | null)?.operationId;
  const opId = typeof rawId === "string" && UUID.safeParse(rawId).success ? rawId : null;
  if (!parsed.success) {
    // Not storable as an operation: nothing to replay. The phone keeps it for review.
    return rejected(
      opId,
      "VALIDATION_FAILED",
      "This count could not be read by the server.",
      `${KEEP} Tell your supervisor; the app may need an update.`,
    );
  }
  const op = parsed.data;
  try {
    return await prisma.$transaction(async (tx) => handle(tx, actor, deviceId, op, ctx), { timeout: 15_000 });
  } catch (e) {
    console.error(`[${ctx.requestId}] sync op ${op.operationId}`, e);
    return {
      operationId: op.operationId,
      status: "RETRYABLE_ERROR",
      code: "INTERNAL",
      message: "The server couldn't save this count just now.",
      nextAction: `${KEEP} It will be sent again automatically, or tap Sync now.`,
    };
  }
}

async function handle(
  tx: Prisma.TransactionClient,
  actor: AccessUser,
  deviceId: string,
  op: Op,
  ctx: Ctx,
): Promise<PushResult> {
  const hash = hashOf(op);
  // Serialize copies of the same operation arriving together (§11.4).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"sync:" + actor.id + ":" + op.operationId}, 0))`;

  const seen = await tx.syncOperation.findUnique({
    where: { userId_operationId: { userId: actor.id, operationId: op.operationId } },
  });
  if (seen) {
    if (seen.payloadHash === hash) return seen.response as unknown as PushResult;
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "sync.operation_reused",
      recordType: "sync_operation",
      recordId: op.operationId,
      after: { deviceId, sessionId: op.sessionId, targetId: op.targetId },
      requestId: ctx.requestId,
    });
    // Not stored: the original outcome under this ID stays as it was (A17).
    return rejected(
      op.operationId,
      "OPERATION_REUSED",
      "This upload ID was already used for a different count, so it was refused.",
      `${KEEP} Tap "Send again" to send it as a new count.`,
    );
  }

  const store = async (result: PushResult) => {
    await tx.syncOperation.create({
      data: {
        userId: actor.id,
        operationId: op.operationId,
        deviceId,
        type: op.type,
        payloadHash: hash,
        result: result.status as "ACKED" | "CONFLICT" | "REJECTED",
        response: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  };

  // Share-lock the session: closing, reviewing and recounts (which take FOR UPDATE)
  // can't interleave with a submission, but submissions from many phones run in
  // parallel. (FOR UPDATE here made all phones queue on one row: 22 s per batch
  // at pilot load.)
  const [session] = await tx.$queryRaw<{ id: string; status: string; location_id: string; reference: string }[]>`
    SELECT id, status, location_id, reference FROM count_sessions WHERE id = ${op.sessionId}::uuid FOR SHARE`;
  const assigned = session
    ? await tx.countSessionAssignee.findUnique({
        where: { sessionId_userId: { sessionId: session.id, userId: actor.id } },
      })
    : null;
  if (!session || !assigned || !can(actor, "counts.submit", session.location_id)) {
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "count.submit_denied",
      recordType: "count_session",
      recordId: op.sessionId,
      after: { operationId: op.operationId, targetId: op.targetId, payload: op.payload },
      requestId: ctx.requestId,
    });
    return store(
      rejected(
        op.operationId,
        "FORBIDDEN",
        "You are no longer allowed to send counts for this assignment.",
        `${KEEP} Ask your supervisor or an administrator to check your access.`,
      ),
    );
  }

  // Lock just this line: the same person's two counts for it can't both stay current.
  // (Lock order everywhere: session, then line.)
  const [line] = await tx.$queryRaw<{ id: string; session_id: string; kind: "STOCK" | "ASSET"; version: number }[]>`
    SELECT id, session_id, kind, version FROM count_session_items WHERE id = ${op.targetId}::uuid FOR UPDATE`;
  const target = line ? { id: line.id, sessionId: line.session_id, kind: line.kind, version: line.version } : null;
  if (!target || target.sessionId !== session.id) {
    return store(
      rejected(
        op.operationId,
        "VALIDATION_FAILED",
        "That item is not part of this count any more.",
        `${KEEP} Ask your supervisor.`,
      ),
    );
  }
  const p = op.payload;
  const shapeOk =
    target.kind === "STOCK"
      ? p.quantity != null && p.found == null && p.condition == null
      : p.found != null && p.quantity == null && (p.found ? p.condition != null : p.condition == null);
  if (!shapeOk) {
    return store(
      rejected(
        op.operationId,
        "VALIDATION_FAILED",
        target.kind === "STOCK"
          ? "A stock count needs a quantity."
          : "An asset check needs found / not found and a condition.",
        `${KEEP} Open it, fix it, and send again.`,
      ),
    );
  }

  const conflict = async (code: string, message: string, nextAction: string) => {
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "count.conflict",
      recordType: "count_session_item",
      recordId: target.id,
      after: { code, operationId: op.operationId, baseVersion: op.baseVersion, payload: op.payload },
      requestId: ctx.requestId,
    });
    return store({
      operationId: op.operationId,
      status: "CONFLICT",
      code,
      message,
      nextAction,
      serverVersion: target.version,
    });
  };
  if (session.status !== "OPEN") {
    return conflict(
      "SESSION_CLOSED",
      `${session.reference} was closed by your supervisor before this count arrived.`,
      `${KEEP} Ask your supervisor to reopen the count or to recount.`,
    );
  }
  if (target.version !== op.baseVersion) {
    return conflict(
      "RECOUNT_REQUESTED",
      "Your supervisor asked for a recount of this line after you counted it.",
      "Count it again, then send.",
    );
  }

  // One current count per person per line: their older one is superseded, not deleted.
  await tx.countEntry.updateMany({
    where: { sessionItemId: target.id, counterId: actor.id, status: "SUBMITTED" },
    data: { status: "SUPERSEDED" },
  });
  const entry = await tx.countEntry.create({
    data: {
      sessionId: session.id,
      sessionItemId: target.id,
      counterId: actor.id,
      quantity: p.quantity ?? null,
      found: p.found ?? null,
      condition: p.found ? (p.condition ?? null) : null,
      notes: p.notes?.trim() || null,
      baseVersion: op.baseVersion,
      operationId: op.operationId,
      deviceId,
      clientRecordedAt: op.clientRecordedAt ? new Date(op.clientRecordedAt) : null,
    },
  });
  await writeAudit(tx, {
    actorId: actor.id,
    eventType: "count.submitted",
    recordType: "count_entry",
    recordId: entry.id,
    after: { sessionId: session.id, targetId: target.id, quantity: entry.quantity, found: entry.found },
    requestId: ctx.requestId,
  });
  return store({
    operationId: op.operationId,
    status: "ACKED",
    serverRecordId: entry.id,
    serverVersion: target.version,
  });
}
