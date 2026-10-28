import { json, pageParam, readJson, route } from "@/lib/api/route";
import { createAssets, listAssets } from "@/lib/assets/service";
import type { CreateAssetsInput } from "@/lib/validation";

export const GET = route({ auth: true }, async ({ req, user }) => {
  const u = new URL(req.url);
  return json(
    await listAssets(user, {
      q: u.searchParams.get("q") ?? undefined,
      status: u.searchParams.get("status") || undefined,
      locationId: u.searchParams.get("locationId") || undefined,
      itemId: u.searchParams.get("itemId") || undefined,
      page: pageParam(u),
    }),
  );
});

/** Add N assets of one item (each gets its own tag). */
export const POST = route({ auth: true }, async ({ req, user, ctx }) =>
  json(await createAssets(user, (await readJson(req)) as CreateAssetsInput, ctx), 201),
);
