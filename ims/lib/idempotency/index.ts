import "server-only";
import { prisma, Prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { sha256, stableStringify } from "@/lib/crypto";

export type IdempotentResult<T> = { status: number; body: T; replayed?: boolean };

type Opts = {
  userId: string;
  /** Client-generated UUID from the Idempotency-Key header. */
  key: string;
  /** e.g. "POST /api/v1/stock/issues" */
  scope: string;
  /** The validated request body. */
  payload: unknown;
};

/**
 * Run `work` at most once per (user, key) (§12.4).
 *
 * - Same key + same payload: returns the stored response (replayed: true).
 * - Same key + different payload: IDEMPOTENCY_KEY_REUSED, nothing runs.
 * - `work` throws: the whole transaction rolls back and no key is stored, so a
 *   retry runs again.
 *
 * `work` receives the transaction client: put the business change in it so the
 * change and the stored outcome commit together.
 */
export async function withIdempotency<T>(
  opts: Opts,
  work: (tx: Prisma.TransactionClient) => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const requestHash = sha256(`${opts.scope}\n${stableStringify(opts.payload)}`);

  return prisma.$transaction(async (tx) => {
    // Serialize concurrent requests carrying the same key.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${opts.userId + ":" + opts.key}, 0))`;

    const existing = await tx.idempotencyKey.findUnique({
      where: { userId_key: { userId: opts.userId, key: opts.key } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash || existing.scope !== opts.scope) {
        throw new ApiError(
          "IDEMPOTENCY_KEY_REUSED",
          "This request ID was already used for a different request. Start the action again.",
        );
      }
      return { status: existing.responseStatus, body: existing.responseBody as T, replayed: true };
    }

    const result = await work(tx);
    await tx.idempotencyKey.create({
      data: {
        userId: opts.userId,
        key: opts.key,
        scope: opts.scope,
        requestHash,
        responseStatus: result.status,
        responseBody: result.body as Prisma.InputJsonValue,
      },
    });
    return result;
  }, { timeout: 15_000 });
}
