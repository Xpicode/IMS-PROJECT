import { idParam, json, readJson, route } from "@/lib/api/route";
import { changeAssetStatus } from "@/lib/assets/service";
import type { ChangeAssetStatusInput } from "@/lib/validation";

export const POST = route({ auth: true }, async ({ req, user, params, ctx }) =>
  json(
    await changeAssetStatus(user, idParam(params, "id", "asset"), (await readJson(req)) as ChangeAssetStatusInput, ctx),
  ),
);
