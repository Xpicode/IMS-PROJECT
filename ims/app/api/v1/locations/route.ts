import { json, readJson, route } from "@/lib/api/route";
import { createLocation, listLocations } from "@/lib/locations/service";
import type { CreateLocationInput } from "@/lib/validation";

export const GET = route({ auth: true }, async ({ req, user }) => {
  const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "true";
  return json({ data: await listLocations(user, { includeInactive }) });
});

export const POST = route({ auth: true }, async ({ req, user, ctx }) =>
  json(await createLocation(user, (await readJson(req)) as CreateLocationInput, ctx), 201),
);
