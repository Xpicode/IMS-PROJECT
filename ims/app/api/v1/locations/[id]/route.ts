import { idParam, json, readJson, route } from "@/lib/api/route";
import { getLocation, updateLocation } from "@/lib/locations/service";
import type { UpdateLocationInput } from "@/lib/validation";

export const GET = route({ auth: true }, async ({ user, params }) =>
  json(await getLocation(user, idParam(params, "id", "location"))),
);

export const PATCH = route({ auth: true }, async ({ req, user, params, ctx }) =>
  json(
    await updateLocation(user, idParam(params, "id", "location"), (await readJson(req)) as UpdateLocationInput, ctx),
  ),
);
