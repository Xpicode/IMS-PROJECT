import { json, readJson, route } from "@/lib/api/route";
import { createUnit, listCatalog } from "@/lib/inventory/items";

export const GET = route({ auth: true }, async ({ user }) => json({ data: (await listCatalog(user)).units }));
export const POST = route({ auth: true }, async ({ req, user, ctx }) =>
  json(await createUnit(user, (await readJson(req)) as { code: string; name: string }, ctx), 201),
);
