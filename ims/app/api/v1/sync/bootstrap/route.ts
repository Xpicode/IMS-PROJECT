import { ApiError } from "@/lib/api/errors";
import { json, route } from "@/lib/api/route";
import { bootstrapSession } from "@/lib/counts/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET ?sessionId= → everything a device needs to count one assignment offline (§11.3).
 * Responses are `no-store` (set by route()); the device keeps them in IndexedDB, never in a cache.
 */
export const GET = route({ auth: true }, async ({ req, user }) => {
  const id = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!UUID.test(id)) throw new ApiError("VALIDATION_FAILED", "Pick an assignment to download.");
  return json(await bootstrapSession(user, id));
});
