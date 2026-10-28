import { ApiError } from "@/lib/api/errors";
import { json, route } from "@/lib/api/route";
import { getBalances } from "@/lib/inventory/stock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?locationId=…&itemIds=a,b → { [itemId]: quantity } */
export const GET = route({ auth: true }, async ({ req, user }) => {
  const u = new URL(req.url);
  const locationId = u.searchParams.get("locationId") ?? "";
  const itemIds = (u.searchParams.get("itemIds") ?? "").split(",").filter((x) => UUID.test(x));
  if (!UUID.test(locationId)) throw new ApiError("VALIDATION_FAILED", "Pick a location.");
  return json(await getBalances(user, locationId, itemIds));
});
