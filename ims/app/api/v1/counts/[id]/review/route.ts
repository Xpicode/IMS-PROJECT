import { idParam, json, route } from "@/lib/api/route";
import { getReview } from "@/lib/counts/review";

/** GET → lines with expected / counted / variance / state, per-counter progress, summary. Supervisors and admins only. */
export const GET = route({ auth: true }, async ({ user, params }) =>
  json(await getReview(user, idParam(params, "id", "count session"))),
);
