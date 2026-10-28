import { idParam, json, readJson, route } from "@/lib/api/route";
import { getAsset, updateAsset } from "@/lib/assets/service";
import type { UpdateAssetInput } from "@/lib/validation";

export const GET = route({ auth: true }, async ({ user, params }) =>
  json(await getAsset(user, idParam(params, "id", "asset"))),
);

/** Serial, condition, custodian, notes. Status changes go through /status. */
export const PATCH = route({ auth: true }, async ({ req, user, params, ctx }) =>
  json(await updateAsset(user, idParam(params, "id", "asset"), (await readJson(req)) as UpdateAssetInput, ctx)),
);
