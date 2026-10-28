import { json, pageParam, readJson, route } from "@/lib/api/route";
import { createItem, listItems } from "@/lib/inventory/items";
import type { CreateItemInput } from "@/lib/validation";

export const GET = route({ auth: true }, async ({ req, user }) => {
  const u = new URL(req.url);
  const stock = u.searchParams.get("stock");
  const tracking = u.searchParams.get("tracking");
  return json(
    await listItems(user, {
      q: u.searchParams.get("q") ?? undefined,
      categoryId: u.searchParams.get("categoryId") || undefined,
      stock: stock === "low" || stock === "out" ? stock : undefined,
      tracking: tracking === "STOCK" || tracking === "ASSET" ? tracking : undefined,
      page: pageParam(u),
      pageSize: Number(u.searchParams.get("pageSize")) || undefined,
    }),
  );
});

export const POST = route({ auth: true }, async ({ req, user, ctx }) =>
  json(await createItem(user, (await readJson(req)) as CreateItemInput, ctx), 201),
);
