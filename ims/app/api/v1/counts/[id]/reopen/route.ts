import { idParam, json, route } from "@/lib/api/route";
import { reopenCountSession } from "@/lib/counts/review";

export const POST = route({ auth: true }, async ({ user, params, ctx }) =>
  json(await reopenCountSession(user, idParam(params, "id", "count session"), ctx)),
);
