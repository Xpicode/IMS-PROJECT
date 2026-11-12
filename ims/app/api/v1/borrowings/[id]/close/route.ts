import { idParam, json, readJson, route } from "@/lib/api/route";
import { closeBorrowing } from "@/lib/borrowing/service";

/** POST { reason } → close an open loan; whatever is still out stays deducted from stock. */
export const POST = route({ auth: true }, async ({ req, user, params, ctx }) => {
  const b = (await readJson(req)) as { reason?: unknown };
  return json(
    await closeBorrowing(user, idParam(params, "id", "loan"), typeof b.reason === "string" ? b.reason : "", ctx),
  );
});
