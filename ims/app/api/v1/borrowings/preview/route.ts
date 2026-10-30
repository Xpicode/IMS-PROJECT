import { z } from "zod";
import { ApiError, errors } from "@/lib/api/errors";
import { readJson, route } from "@/lib/api/route";
import { requireAccess } from "@/lib/permissions";
import { prisma } from "@/lib/db/prisma";
import { previewPdf } from "@/lib/documents/service";
import { formatDateTime } from "@/lib/format";

const COND: Record<string, string> = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };
const body = z.object({
  locationId: z.string().uuid(),
  borrowerName: z.string().max(120).default(""),
  borrowerDept: z.string().max(120).optional(),
  purpose: z.string().max(300).default(""),
  dueAt: z.string().nullish(),
  receivedByName: z.string().max(120).optional(),
  preparedByName: z.string().max(120).optional(),
  lines: z
    .array(z.object({ assetId: z.string().uuid(), condition: z.string(), accessories: z.string().max(300).optional() }))
    .max(100),
});

/** POST → a DRAFT preview of the Equipment Borrowing form (watermarked, no number, nothing saved). */
export const POST = route({ auth: true }, async ({ req, user }) => {
  const b = body.safeParse(await readJson(req));
  if (!b.success) throw new ApiError("VALIDATION_FAILED", "The preview request is not valid.");
  const d = b.data;
  requireAccess(user, "custody.confirm", d.locationId);
  const [loc, assets] = await Promise.all([
    prisma.location.findUnique({ where: { id: d.locationId }, select: { code: true, name: true } }),
    // Only assets at this location, like the release itself; others show as "?".
    prisma.asset.findMany({
      where: { id: { in: d.lines.map((l) => l.assetId) }, locationId: d.locationId },
      select: { id: true, tag: true, serialNumber: true, item: { select: { name: true } } },
    }),
  ]);
  if (!loc) throw errors.notFound("location");
  const byId = new Map(assets.map((a) => [a.id, a]));
  const bytes = await previewPdf({
    type: "EQUIPMENT_BORROWING",
    title: "Equipment Borrowing Form",
    fields: [
      { label: "Borrower", value: d.borrowerName || "—" },
      { label: "Department / site", value: d.borrowerDept || "—" },
      { label: "Purpose", value: d.purpose || "—" },
      { label: "Due back", value: d.dueAt ? formatDateTime(d.dueAt) : "—" },
      { label: "Released from", value: `${loc.code} · ${loc.name}` },
      { label: "Released by", value: user.name },
    ],
    columns: [
      { key: "no", label: "#", width: 0.06, align: "right" },
      { key: "tag", label: "Asset tag", width: 0.16 },
      { key: "desc", label: "Description", width: 0.34 },
      { key: "cond", label: "Condition", width: 0.14 },
      { key: "acc", label: "Accessories", width: 0.3 },
    ],
    rows: d.lines.map((l, i) => {
      const a = byId.get(l.assetId);
      return {
        no: String(i + 1),
        tag: a?.tag ?? "?",
        desc: a ? a.item.name + (a.serialNumber ? ` · S/N ${a.serialNumber}` : "") : "",
        cond: COND[l.condition] ?? "",
        acc: l.accessories || "—",
      };
    }),
    remarks: "Preview only. This is not an official document until the release is confirmed.",
    signatures: [
      { role: "Prepared by", name: d.preparedByName || user.name },
      { role: "Released by", name: user.name },
      { role: "Received by (borrower)", name: d.receivedByName || d.borrowerName || null },
      { role: "Approved by", name: null },
    ],
  });
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="DRAFT_Equipment_Borrowing.pdf"',
    },
  });
});
