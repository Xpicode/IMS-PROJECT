import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import type { BulkResult } from "@/lib/bulk-delete";

const list = (xs: string[]) =>
  xs.length > 5 ? `${xs.slice(0, 5).join(", ")} and ${xs.length - 5} more` : xs.join(", ");

/** Select and delete on a list: calls the API and says plainly what was deleted, hidden or skipped. */
export async function runBulkDelete(type: "items" | "assets" | "locations" | "users", ids: string[]) {
  const r = await apiFetch<BulkResult>(`/api/v1/${type}/bulk-delete`, { method: "POST", body: { ids } });
  const done = [
    r.deleted.length && `Deleted ${r.deleted.length}: ${list(r.deleted)}.`,
    r.hidden.length &&
      (type === "assets"
        ? `Retired ${r.hidden.length}: ${list(r.hidden)}.`
        : `Hidden ${r.hidden.length} (they have history, which is kept): ${list(r.hidden)}.`),
  ].filter(Boolean);
  if (done.length) toast.success(done.join(" "));
  for (const s of r.skipped) toast.warning(`${s.label} wasn't removed: ${s.reason}`);
  return r;
}
