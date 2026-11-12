import { ApiError } from "@/lib/api/errors";
import { json, readJson, route } from "@/lib/api/route";
import { commitItemImport, IMPORT_COLUMNS, MAX_IMPORT_BYTES, previewItemImport } from "@/lib/inventory/import";
import {
  IMPORT_TEMPLATE_INSTRUCTIONS,
  IMPORT_TEMPLATE_TITLE,
  parseItemWorkbook,
  readImportForm,
} from "@/lib/inventory/import-file";
import { requireAccess } from "@/lib/permissions";
import { toXlsx } from "@/lib/xlsx";
import { company } from "@/lib/documents/service";
import { formatDateTime } from "@/lib/format";

export const runtime = "nodejs";

export const GET = route({ auth: true }, async ({ user }) => {
  requireAccess(user, "masterData.manage");
  const workbook = toXlsx(
    "Items",
    [...IMPORT_COLUMNS],
    [
      ["PPE-0100", "Safety Goggles", "PPE", "pcs", "STOCK", 10, "", "001234567890"],
      ["TOOL-GRINDER", "Angle Grinder", "Tools", "pcs", "ASSET", 0, "", ""],
    ],
    ["text", undefined, undefined, undefined, undefined, "integer", undefined, "text"],
    {
      company: company().name,
      title: IMPORT_TEMPLATE_TITLE,
      details: [
        `Generated: ${formatDateTime(new Date())} (${process.env.NEXT_PUBLIC_COMPANY_TIMEZONE || "Asia/Manila"})`,
        IMPORT_TEMPLATE_INSTRUCTIONS,
      ],
    },
  );
  return new Response(new Uint8Array(workbook), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="ims-items-template.xlsx"',
      "x-content-type-options": "nosniff",
    },
  });
});

/** { csv: string, mode: "preview" | "commit" }. Preview never writes. */
export const POST = route({ auth: true }, async ({ req, user, ctx }) => {
  requireAccess(user, "masterData.manage");
  if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const form = await readImportForm(req);
    const file = form.get("file");
    if (!(file instanceof File) || !/\.(xlsx|csv)$/i.test(file.name))
      throw new ApiError("VALIDATION_FAILED", "Choose an .xlsx or .csv file. Legacy .xls files are not supported.");
    if (file.size > MAX_IMPORT_BYTES)
      throw new ApiError("VALIDATION_FAILED", "The file is larger than 2 MB. Split it into smaller files.");
    const data = /\.xlsx$/i.test(file.name)
      ? await parseItemWorkbook(Buffer.from(await file.arrayBuffer()))
      : await file.text();
    if (form.get("mode") === "commit") return json(await commitItemImport(user, data, ctx), 201);
    return json(await previewItemImport(user, data));
  }
  // Room for a full-size CSV after JSON escaping; the CSV itself is capped at MAX_IMPORT_BYTES by the service.
  const body = (await readJson(req, 2 * MAX_IMPORT_BYTES)) as { csv?: unknown; mode?: unknown };
  if (typeof body.csv !== "string") throw new ApiError("VALIDATION_FAILED", "Choose a CSV file to import.");
  if (body.mode === "commit") return json(await commitItemImport(user, body.csv, ctx), 201);
  return json(await previewItemImport(user, body.csv));
});
