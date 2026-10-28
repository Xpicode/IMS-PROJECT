import { idParam, json, readJson, route } from "@/lib/api/route";
import { getItem, updateItem } from "@/lib/inventory/items";
import type { UpdateItemInput } from "@/lib/validation";

export const GET = route({ auth: true }, async ({ user, params }) =>
  json(await getItem(user, idParam(params, "id", "item"))),
);

export const PATCH = route({ auth: true }, async ({ req, user, params, ctx }) =>
  json(await updateItem(user, idParam(params, "id", "item"), (await readJson(req)) as UpdateItemInput, ctx)),
);
