import { idParam, json, route } from "@/lib/api/route";
import { retryDocument } from "@/lib/documents/service";

/** POST → draw the PDF again from its frozen snapshot (§13.7). Never touches stock or assets. */
export const POST = route({ auth: true }, async ({ user, params, ctx }) => {
  const d = await retryDocument(user, idParam(params, "id", "document"), ctx);
  return json({ id: d.id, reference: d.reference, status: d.status, lastError: d.lastError });
});
