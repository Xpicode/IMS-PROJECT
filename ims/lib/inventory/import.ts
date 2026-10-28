import "server-only";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import type { Ctx } from "@/lib/context";
import { parseCsv } from "@/lib/csv";
import { normalizeCode } from "@/lib/codes";
import { createItemSchema, fieldErrors } from "@/lib/validation";
import { guessKind } from "./items";

export const IMPORT_COLUMNS = [
  "sku",
  "name",
  "category",
  "unit",
  "tracking_type",
  "min_stock",
  "description",
  "barcode",
] as const;
const REQUIRED = ["sku", "name", "unit", "tracking_type"] as const;
const MAX_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2_000_000;

export type PreviewRow = {
  line: number;
  ok: boolean;
  errors: string[];
  data: {
    sku: string;
    name: string;
    category: string;
    unit: string;
    trackingType: string;
    minStock: string;
    barcode: string;
  };
};

type Valid = {
  sku: string;
  name: string;
  description?: string;
  categoryId: string | null;
  unitId: string;
  trackingType: "STOCK" | "ASSET";
  minStock: number;
  barcode?: string;
};

/** Validate every row against the database without writing anything. */
async function validate(text: string) {
  if (text.length > MAX_IMPORT_BYTES)
    throw new ApiError("VALIDATION_FAILED", "The file is larger than 2 MB. Split it into smaller files.");
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (e) {
    throw new ApiError("VALIDATION_FAILED", (e as Error).message);
  }
  if (table.length < 2)
    throw new ApiError("VALIDATION_FAILED", "The file has no data rows. The first row must be the column names.");
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `The file is missing the column(s): ${missing.join(", ")}. Use the template columns: ${IMPORT_COLUMNS.join(", ")}.`,
    );
  }
  if (table.length - 1 > MAX_ROWS) throw new ApiError("VALIDATION_FAILED", `Import up to ${MAX_ROWS} rows at a time.`);

  const [units, categories, existingSkus, existingCodes] = await Promise.all([
    prisma.unit.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.item.findMany({ select: { sku: true } }),
    prisma.itemIdentifier.findMany({ where: { isActive: true }, select: { code: true } }),
  ]);
  const unitBy = new Map(units.map((u) => [u.code.toLowerCase(), u.id]));
  const catBy = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const skuTaken = new Set(existingSkus.map((s) => s.sku));
  const codeTaken = new Set(existingCodes.map((c) => c.code));
  const skuLine = new Map<string, number>();
  const codeLine = new Map<string, number>();

  const rows: PreviewRow[] = [];
  const valid: Valid[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (c: string) => (cells[header.indexOf(c)] ?? "").trim();
    const raw = {
      sku: get("sku"),
      name: get("name"),
      category: get("category"),
      unit: get("unit"),
      trackingType: get("tracking_type").toUpperCase(),
      minStock: get("min_stock"),
      barcode: get("barcode"),
    };
    const errs: string[] = [];
    const unitId = unitBy.get(raw.unit.toLowerCase());
    if (!raw.unit) errs.push("Unit is empty.");
    else if (!unitId)
      errs.push(`Unit "${raw.unit}" doesn't exist. Add it under Units & categories, or use an existing unit.`);
    let categoryId: string | null = null;
    if (raw.category) {
      categoryId = catBy.get(raw.category.toLowerCase()) ?? null;
      if (!categoryId)
        errs.push(`Category "${raw.category}" doesn't exist. Add it under Units & categories, or leave it blank.`);
    }
    const minStock = raw.minStock === "" ? 0 : Number(raw.minStock);
    const parsed = createItemSchema.safeParse({
      sku: raw.sku,
      name: raw.name,
      description: get("description") || undefined,
      unitId: unitId ?? "00000000-0000-4000-8000-000000000000",
      trackingType: raw.trackingType,
      minStock,
      barcode: raw.barcode || undefined,
    });
    if (!parsed.success) {
      for (const [k, msgs] of Object.entries(fieldErrors(parsed.error))) {
        if (k !== "unitId")
          errs.push(`${k === "minStock" ? "min_stock" : k === "trackingType" ? "tracking_type" : k}: ${msgs[0]}`);
      }
    }
    const sku = raw.sku.trim().toUpperCase();
    if (sku) {
      if (skuTaken.has(sku)) errs.push(`SKU ${sku} already exists.`);
      else if (skuLine.has(sku)) errs.push(`Same SKU as line ${skuLine.get(sku)}.`);
      else skuLine.set(sku, line);
    }
    const barcode = raw.barcode ? normalizeCode(raw.barcode) : "";
    if (barcode) {
      if (codeTaken.has(barcode) || skuTaken.has(barcode))
        errs.push(`Barcode ${barcode} is already used by another record.`);
      else if (codeLine.has(barcode)) errs.push(`Same barcode as line ${codeLine.get(barcode)}.`);
      else codeLine.set(barcode, line);
    }
    rows.push({ line, ok: errs.length === 0, errors: errs, data: raw });
    if (!errs.length && parsed.success) {
      valid.push({
        sku: parsed.data.sku,
        name: parsed.data.name,
        description: parsed.data.description,
        categoryId,
        unitId: unitId!,
        trackingType: parsed.data.trackingType,
        minStock: parsed.data.minStock,
        barcode: barcode || undefined,
      });
    }
  });
  return { rows, valid };
}

export async function previewItemImport(actor: AccessUser, text: string) {
  requireAccess(actor, "masterData.manage");
  const { rows, valid } = await validate(text);
  return { rows, validCount: valid.length, errorCount: rows.length - valid.length };
}

/** Re-validates, then creates all valid rows in one transaction. Invalid rows are skipped. */
export async function commitItemImport(actor: AccessUser, text: string, ctx: Ctx) {
  requireAccess(actor, "masterData.manage");
  const { rows, valid } = await validate(text);
  if (!valid.length)
    throw new ApiError("VALIDATION_FAILED", "No valid rows to import. Fix the errors shown in the preview.");
  await prisma.$transaction(
    async (tx) => {
      for (const v of valid) {
        await tx.item.create({
          data: {
            sku: v.sku,
            name: v.name,
            description: v.description,
            categoryId: v.categoryId,
            unitId: v.unitId,
            trackingType: v.trackingType,
            minStock: v.minStock,
            ...(v.barcode
              ? { identifiers: { create: { namespace: "MFR", code: v.barcode, kind: guessKind(v.barcode) } } }
              : {}),
          },
        });
      }
      await writeAudit(tx, {
        actorId: actor.id,
        eventType: "items.imported",
        recordType: "item",
        after: {
          imported: valid.length,
          skipped: rows.length - valid.length,
          skus: valid.map((v) => v.sku).slice(0, 200),
        },
        requestId: ctx.requestId,
      });
    },
    { timeout: 60_000 },
  );
  return { imported: valid.length, skipped: rows.length - valid.length };
}
