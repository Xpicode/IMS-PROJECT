import { ApiError } from "@/lib/api/errors";
import { json, readJson, route } from "@/lib/api/route";
import { commitItemImport, MAX_IMPORT_BYTES, previewItemImport } from "@/lib/inventory/import";

/** { csv: string, mode: "preview" | "commit" }. Preview never writes. */
export const POST = route({ auth: true }, async ({ req, user, ctx }) => {
  // Room for a full-size CSV after JSON escaping; the CSV itself is capped at MAX_IMPORT_BYTES by the service.
  const body = (await readJson(req, 2 * MAX_IMPORT_BYTES)) as { csv?: unknown; mode?: unknown };
  if (typeof body.csv !== "string") throw new ApiError("VALIDATION_FAILED", "Choose a CSV file to import.");
  if (body.mode === "commit") return json(await commitItemImport(user, body.csv, ctx), 201);
  return json(await previewItemImport(user, body.csv));
});
