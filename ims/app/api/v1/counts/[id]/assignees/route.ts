import { idParam, json, readJson, route } from "@/lib/api/route";
import { setCountAssignees } from "@/lib/counts/service";

/** POST { assigneeIds } → who counts this open count (replaces the list). */
export const POST = route({ auth: true }, async ({ req, user, params, ctx }) =>
  json(await setCountAssignees(user, idParam(params, "id", "count session"), await readJson(req), ctx)),
);
