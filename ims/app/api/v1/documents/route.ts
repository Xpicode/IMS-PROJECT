import { json, pageParam, route } from "@/lib/api/route";
import { listDocuments, type DocType } from "@/lib/documents/service";

const TYPES: DocType[] = ["STOCK_ISSUANCE", "TRANSMITTAL", "EQUIPMENT_BORROWING", "RETURN_ACKNOWLEDGMENT"];
const STATUSES = ["READY", "PDF_FAILED", "PENDING"] as const;

export const GET = route({ auth: true }, async ({ req, user }) => {
  const u = new URL(req.url);
  const type = u.searchParams.get("type") as DocType;
  const status = u.searchParams.get("status") as (typeof STATUSES)[number];
  return json(
    await listDocuments(user, {
      q: u.searchParams.get("q") ?? undefined,
      type: TYPES.includes(type) ? type : undefined,
      status: STATUSES.includes(status) ? status : undefined,
      page: pageParam(u),
    }),
  );
});
