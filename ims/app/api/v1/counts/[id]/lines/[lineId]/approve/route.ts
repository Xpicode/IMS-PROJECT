import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { idempotencyKey, idempotentJson, idParam, readJson, route } from "@/lib/api/route";
import { approveLine } from "@/lib/counts/review";

const body = z.object({ entryId: z.string().uuid().optional(), notes: z.string().max(500).optional() });

/** POST (Idempotency-Key required) → approve one line; posts at most one ADJ- adjustment (A20, A21). */
export const POST = route({ auth: true }, async ({ req, user, params, ctx }) => {
  const key = idempotencyKey(req);
  const b = body.safeParse(await readJson(req));
  if (!b.success) throw new ApiError("VALIDATION_FAILED", "The approval request is not valid.");
  return idempotentJson(
    await approveLine(
      user,
      idParam(params, "id", "count session"),
      idParam(params, "lineId", "count line"),
      b.data,
      ctx,
      key,
    ),
  );
});
