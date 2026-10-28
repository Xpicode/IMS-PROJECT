import { idempotencyKey, idempotentJson, readJson, route } from "@/lib/api/route";
import { receiveStock } from "@/lib/inventory/stock";
import type { ReceiptInput } from "@/lib/validation";

/** Confirm a stock receipt. Requires an Idempotency-Key header (§12.4). */
export const POST = route({ auth: true }, async ({ req, user, ctx }) => {
  const key = idempotencyKey(req);
  return idempotentJson(await receiveStock(user, (await readJson(req)) as ReceiptInput, ctx, key));
});
