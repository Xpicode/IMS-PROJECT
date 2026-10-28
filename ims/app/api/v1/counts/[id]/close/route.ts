import { idParam, json, route } from "@/lib/api/route";
import { closeCountSession } from "@/lib/counts/service";

export const POST = route({ auth: true }, async ({ user, params, ctx }) =>
  json(await closeCountSession(user, idParam(params, "id", "count session"), ctx)),
);
