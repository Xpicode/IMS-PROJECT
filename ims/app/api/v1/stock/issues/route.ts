import { idempotencyKey, idempotentJson, readJson, route } from "@/lib/api/route";
import { issueStock } from "@/lib/inventory/stock";
import type { IssueInput } from "@/lib/validation";

/** Confirm a stock issue. Requires an Idempotency-Key header (§12.4). */
export const POST = route({ auth: true }, async ({ req, user, ctx }) => {
  const key = idempotencyKey(req);
  return idempotentJson(await issueStock(user, (await readJson(req)) as IssueInput, ctx, key));
});
