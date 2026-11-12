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
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.number().int().positive().max(1_000_000),
        condition: z.string().default("GOOD"),
        accessories: z.string().max(300).optional(),
      }),
    )
    .max(100),
});

/** POST → a DRAFT preview of the Equipment Borrowing form (watermarked, no number, nothing saved). */
export const POST = route({ auth: true }, async ({ req, user }) => {
  const b = body.safeParse(await readJson(req));
  if (!b.success) throw new ApiError("VALIDATION_FAILED", "The preview request is not valid.");
  const d = b.data;
  requireAccess(user, "custody.confirm", d.locationId);
  const [loc, items] = await Promise.all([
    prisma.location.findUnique({ where: { id: d.locationId }, select: { code: true, name: true } }),
    prisma.item.findMany({
      where: { id: { in: d.lines.map((l) => l.itemId) } },
      select: { id: true, sku: true, name: true, unit: { select: { code: true } } },
    }),
  ]);
  if (!loc) throw errors.notFound("location");
  const byId = new Map(items.map((i) => [i.id, i]));
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
      { key: "code", label: "SKU", width: 0.16 },
      { key: "desc", label: "Description", width: 0.32 },
      { key: "qty", label: "Qty", width: 0.1, align: "right" },
      { key: "cond", label: "Condition", width: 0.12 },
      { key: "acc", label: "Accessories", width: 0.24 },
    ],
    rows: d.lines.map((l, i) => {
      const it = byId.get(l.itemId);
      return {
        no: String(i + 1),
        code: it?.sku ?? "?",
        desc: it?.name ?? "",
        qty: it ? `${l.quantity} ${it.unit.code}` : String(l.quantity),
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
