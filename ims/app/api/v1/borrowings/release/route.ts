import { idempotencyKey, idempotentJson, readJson, route } from "@/lib/api/route";
import { releaseBorrowing } from "@/lib/borrowing/service";
import type { ReleaseInput } from "@/lib/validation";

/** POST (Idempotency-Key required) → release assets on a new or drafted loan (§7.5). */
export const POST = route({ auth: true }, async ({ req, user, ctx }) => {
  const key = idempotencyKey(req);
  return idempotentJson(await releaseBorrowing(user, (await readJson(req)) as ReleaseInput, ctx, key));
});
