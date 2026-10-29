import { idParam, json, route } from "@/lib/api/route";
import { documentStatus } from "@/lib/documents/service";

/** GET → status of one document (for success screens and Retry). */
export const GET = route({ auth: true }, async ({ user, params }) =>
  json(await documentStatus(user, idParam(params, "id", "document"))),
);
