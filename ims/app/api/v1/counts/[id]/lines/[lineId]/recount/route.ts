import { idParam, json, route } from "@/lib/api/route";
import { requestRecount } from "@/lib/counts/review";

export const POST = route({ auth: true }, async ({ user, params, ctx }) =>
  json(
    await requestRecount(user, idParam(params, "id", "count session"), idParam(params, "lineId", "count line"), ctx),
  ),
);
