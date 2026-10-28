import { json, readJson, route } from "@/lib/api/route";
import { pushOperations } from "@/lib/counts/sync";

/**
 * POST { deviceId, operations[≤50] } → { results[], serverTime } (spec §11.3).
 * Each operation gets its own result; see lib/counts/sync.ts for the rules.
 */
export const POST = route({ auth: true }, async ({ req, user, ctx }) =>
  json(await pushOperations(user, await readJson(req), ctx)),
);
