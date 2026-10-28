import { json, readJson, route } from "@/lib/api/route";
import { createCategory, listCatalog } from "@/lib/inventory/items";

export const GET = route({ auth: true }, async ({ user }) => json({ data: (await listCatalog(user)).categories }));
export const POST = route({ auth: true }, async ({ req, user, ctx }) =>
  json(await createCategory(user, (await readJson(req)) as { name: string }, ctx), 201),
);
