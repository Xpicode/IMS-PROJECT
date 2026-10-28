import { idParam, json, route } from "@/lib/api/route";
import { approveAllMatching } from "@/lib/counts/review";

/** Approve every counted line that matches the records exactly (no adjustment is posted). */
export const POST = route({ auth: true }, async ({ user, params, ctx }) =>
  json(await approveAllMatching(user, idParam(params, "id", "count session"), ctx)),
);
