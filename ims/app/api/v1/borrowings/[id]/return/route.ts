import { idempotencyKey, idempotentJson, idParam, readJson, route } from "@/lib/api/route";
import { returnItems } from "@/lib/borrowing/service";
import type { ReturnInput } from "@/lib/validation";

/** POST (Idempotency-Key required) → return some or all of a loan; it goes back into stock (§7.6). */
export const POST = route({ auth: true }, async ({ req, user, params, ctx }) => {
  const key = idempotencyKey(req);
  return idempotentJson(
    await returnItems(user, idParam(params, "id", "loan"), (await readJson(req)) as ReturnInput, ctx, key),
  );
});
