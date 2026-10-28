import { idempotencyKey, idempotentJson, readJson, route } from "@/lib/api/route";
import { transferStock } from "@/lib/inventory/stock";
import type { TransferInput } from "@/lib/validation";

/** Confirm a stock transfer. Requires an Idempotency-Key header (§12.4). */
export const POST = route({ auth: true }, async ({ req, user, ctx }) => {
  const key = idempotencyKey(req);
  return idempotentJson(await transferStock(user, (await readJson(req)) as TransferInput, ctx, key));
});
