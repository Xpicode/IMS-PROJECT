import { idParam, json, readJson, route } from "@/lib/api/route";
import { cancelBorrowDraft } from "@/lib/borrowing/service";

export const POST = route({ auth: true }, async ({ req, user, params, ctx }) => {
  const b = (await readJson(req)) as { reason?: unknown };
  return json(
    await cancelBorrowDraft(
      user,
      idParam(params, "id", "borrowing request"),
      typeof b.reason === "string" ? b.reason : "",
      ctx,
    ),
  );
});
