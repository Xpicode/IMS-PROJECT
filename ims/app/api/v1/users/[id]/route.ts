import { idParam, json, readJson, route } from "@/lib/api/route";
import { getUser, updateUser } from "@/lib/users/service";
import type { UpdateUserInput } from "@/lib/validation";

export const GET = route({ auth: true }, async ({ user, params }) =>
  json(await getUser(user, idParam(params, "id", "user"))),
);

/** Edit name/role/locations or deactivate (status: "INACTIVE"). Users are never deleted. */
export const PATCH = route({ auth: true }, async ({ req, user, params, ctx }) =>
  json(await updateUser(user, idParam(params, "id", "user"), (await readJson(req)) as UpdateUserInput, ctx)),
);
