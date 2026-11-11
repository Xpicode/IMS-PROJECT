import { idParam, json, readJson, route } from "@/lib/api/route";
import { updateUnit } from "@/lib/inventory/items";

export const PATCH = route({ auth: true }, async ({ req, user, params, ctx }) =>
  json(
    await updateUnit(user, idParam(params, "id", "unit"), (await readJson(req)) as { code: string; name: string }, ctx),
  ),
);
