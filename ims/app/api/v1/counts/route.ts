import { json, pageParam, readJson, route } from "@/lib/api/route";
import { createCountSession, listCountSessions } from "@/lib/counts/service";
import type { CreateCountInput } from "@/lib/validation";

export const GET = route({ auth: true }, async ({ req, user }) => {
  const u = new URL(req.url);
  const status = u.searchParams.get("status");
  return json(
    await listCountSessions(user, {
      status: status === "OPEN" || status === "CLOSED" ? status : undefined,
      page: pageParam(u),
    }),
  );
});

export const POST = route({ auth: true }, async ({ req, user, ctx }) =>
  json(await createCountSession(user, (await readJson(req)) as CreateCountInput, ctx), 201),
);
