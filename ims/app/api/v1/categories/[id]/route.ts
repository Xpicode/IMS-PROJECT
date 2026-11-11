import { idParam, json, readJson, route } from "@/lib/api/route";
import { updateCategory } from "@/lib/inventory/items";

export const PATCH = route({ auth: true }, async ({ req, user, params, ctx }) =>
  json(await updateCategory(user, idParam(params, "id", "category"), (await readJson(req)) as { name: string }, ctx)),
);
