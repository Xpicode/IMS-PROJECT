import { json, route } from "@/lib/api/route";
import { errors } from "@/lib/api/errors";
import { resolveCode } from "@/lib/inventory/lookup";

const HREF = { item: "/stock/items/", asset: "/assets/", location: "/locations?q=" } as const;

/** ?code=… → what a scanned/typed code points to, with the page to open. */
export const GET = route({ auth: true }, async ({ req, user }) => {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const found = await resolveCode(user, code);
  if (!found) throw errors.notFound("code");
  const href =
    found.type === "location"
      ? HREF.location + encodeURIComponent(found.label.split(" · ")[0])
      : HREF[found.type] + found.id;
  return json({ ...found, href });
});
