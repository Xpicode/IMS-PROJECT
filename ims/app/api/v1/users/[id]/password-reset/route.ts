import { idParam, json, route } from "@/lib/api/route";
import { issuePasswordReset } from "@/lib/users/service";

/** Admin: create a one-time reset link (1 hour). The link is shown once. */
export const POST = route({ auth: true }, async ({ req, user, params, ctx }) => {
  const { token, expiresAt } = await issuePasswordReset(user, idParam(params, "id", "user"), ctx);
  const url = new URL(`/reset-password?token=${encodeURIComponent(token)}`, req.url);
  return json({ url: url.pathname + url.search, expiresAt }, 201);
});
