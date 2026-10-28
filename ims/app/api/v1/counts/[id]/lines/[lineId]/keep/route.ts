import { idParam, json, readJson, route } from "@/lib/api/route";
import { keepExpected } from "@/lib/counts/review";

export const POST = route({ auth: true }, async ({ req, user, params, ctx }) => {
  const b = (await readJson(req)) as { notes?: unknown };
  const notes = typeof b.notes === "string" ? b.notes.slice(0, 500) : undefined;
  return json(
    await keepExpected(
      user,
      idParam(params, "id", "count session"),
      idParam(params, "lineId", "count line"),
      { notes },
      ctx,
    ),
  );
});
