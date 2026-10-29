import { idParam, json, route } from "@/lib/api/route";
import { getBorrowing } from "@/lib/borrowing/service";

export const GET = route({ auth: true }, async ({ user, params }) =>
  json(await getBorrowing(user, idParam(params, "id", "loan"))),
);
