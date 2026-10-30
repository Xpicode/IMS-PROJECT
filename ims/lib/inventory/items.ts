import "server-only";
import { likeEscape } from "@/lib/db/search";
import { prisma, Prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessScope, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { normalizeCode } from "@/lib/codes";
import type { Ctx } from "@/lib/context";
import {
  categorySchema,
  createItemSchema,
  parse,
  unitSchema,
  updateItemSchema,
  type CreateItemInput,
  type UpdateItemInput,
  uuid,
} from "@/lib/validation";

export type StockStatus = "OK" | "LOW" | "OUT";
export const stockStatus = (onHand: number, minStock: number): StockStatus =>
  onHand <= 0 ? "OUT" : onHand <= minStock ? "LOW" : "OK";

/** Location ids this scope may read, or null for "all". */
export const scopeLocations = (s: AccessScope) => (s.scope === "global" ? null : s.locationIds);

/**
 * Items are company-wide master data (one record, balances per location).
 * Supervisors may add and edit them; field staff may only view (§5).
 */
export async function createItem(actor: AccessUser, input: CreateItemInput, ctx: Ctx) {
  requireAccess(actor, "masterData.manage");
  const data = parse(createItemSchema, input);
  if (data.trackingType === "ASSET" && data.minStock) {
    throw new ApiError("VALIDATION_FAILED", "Minimum stock applies to counted stock, not individually tagged assets.", {
      fields: { minStock: ["Leave at 0 for assets."] },
    });
  }
  const dup = await prisma.item.findUnique({ where: { sku: data.sku }, select: { id: true } });
  if (dup)
    throw new ApiError("DUPLICATE", `SKU ${data.sku} already exists.`, {
      fields: { sku: ["This SKU is already in use."] },
    });
  const unit = await prisma.unit.findUnique({ where: { id: data.unitId }, select: { isActive: true } });
  if (!unit?.isActive)
    throw new ApiError("VALIDATION_FAILED", "Pick an active unit.", { fields: { unitId: ["Pick a unit."] } });
  const barcode = data.barcode ? normalizeCode(data.barcode) : undefined;
  if (barcode) await assertCodeFree("MFR", barcode);

  return prisma.$transaction(async (tx) => {
    const item = await tx.item.create({
      data: {
        sku: data.sku,
        name: data.name,
        description: data.description,
        categoryId: data.categoryId ?? null,
        unitId: data.unitId,
        trackingType: data.trackingType,
        minStock: data.minStock,
        brand: data.brand,
        model: data.model,
        ...(barcode ? { identifiers: { create: { namespace: "MFR", code: barcode, kind: guessKind(barcode) } } } : {}),
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "item.created",
      recordType: "item",
      recordId: item.id,
      after: { sku: item.sku, name: item.name, trackingType: item.trackingType, barcode },
      requestId: ctx.requestId,
    });
    return item;
  });
}

export async function updateItem(actor: AccessUser, id: string, input: UpdateItemInput, ctx: Ctx) {
  requireAccess(actor, "masterData.manage");
  const patch = parse(updateItemSchema, input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.item.findUnique({ where: { id } });
    if (!before) throw errors.notFound("item");
    const item = await tx.item.update({ where: { id }, data: patch });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "item.updated",
      recordType: "item",
      recordId: id,
      before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof typeof before]])),
      after: patch,
      requestId: ctx.requestId,
    });
    return item;
  });
}

export const guessKind = (code: string) =>
  /^\d{13}$/.test(code) ? ("EAN13" as const) : /^\d{12}$/.test(code) ? ("UPCA" as const) : ("CODE128" as const);

export async function assertCodeFree(namespace: string, code: string) {
  const taken = await prisma.itemIdentifier.findFirst({
    where: { namespace, code, isActive: true },
    select: { id: true },
  });
  const skuOrTag =
    (await prisma.item.findUnique({ where: { sku: code }, select: { id: true } })) ??
    (await prisma.asset.findUnique({ where: { tag: code }, select: { id: true } }));
  if (taken || skuOrTag) {
    throw new ApiError("DUPLICATE", `The code ${code} is already used by another record.`, {
      fields: { barcode: ["This code is already in use."] },
    });
  }
}

type ListOpts = {
  q?: string;
  categoryId?: string;
  stock?: "low" | "out";
  tracking?: "STOCK" | "ASSET";
  includeInactive?: boolean;
  /** Only items with a low-stock level set (someone asked to be warned). */
  watched?: boolean;
  page?: number;
  pageSize?: number;
};

export type ItemRow = {
  id: string;
  sku: string;
  name: string;
  trackingType: "STOCK" | "ASSET";
  minStock: number;
  isActive: boolean;
  photoPath: string | null;
  categoryName: string | null;
  unitCode: string;
  onHand: number;
  assetCount: number;
  stockStatus: StockStatus | null;
};

/** Item list with on-hand totals over the locations this user can see. */
export async function listItems(actor: AccessUser, opts: ListOpts = {}) {
  const scope = requireAccess(actor, "records.view");
  const locs = scopeLocations(scope);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));
  const q = opts.q?.trim().slice(0, 100);
  const locFilter = locs ? Prisma.sql`AND b.location_id = ANY(${locs}::uuid[])` : Prisma.empty;
  const assetLocFilter = locs ? Prisma.sql`AND a.location_id = ANY(${locs}::uuid[])` : Prisma.empty;

  const where = [
    opts.includeInactive ? Prisma.sql`TRUE` : Prisma.sql`i.is_active`,
    q
      ? Prisma.sql`(i.sku ILIKE ${"%" + likeEscape(q) + "%"} OR i.name ILIKE ${"%" + likeEscape(q) + "%"}
          OR EXISTS (SELECT 1 FROM item_identifiers x WHERE x.item_id = i.id AND x.is_active AND x.code = ${normalizeCode(q)}))`
      : Prisma.sql`TRUE`,
    // A malformed category id from a URL is ignored (was a database error).
    uuid.safeParse(opts.categoryId).success ? Prisma.sql`i.category_id = ${opts.categoryId}::uuid` : Prisma.sql`TRUE`,
    opts.tracking ? Prisma.sql`i.tracking_type = ${opts.tracking}::"TrackingType"` : Prisma.sql`TRUE`,
    opts.watched ? Prisma.sql`i.min_stock > 0` : Prisma.sql`TRUE`,
  ];
  const having =
    opts.stock === "out"
      ? Prisma.sql`HAVING i.tracking_type = 'STOCK' AND COALESCE(SUM(b.quantity), 0) <= 0`
      : opts.stock === "low"
        ? Prisma.sql`HAVING i.tracking_type = 'STOCK' AND COALESCE(SUM(b.quantity), 0) > 0 AND COALESCE(SUM(b.quantity), 0) <= i.min_stock`
        : Prisma.empty;

  const base = Prisma.sql`
    SELECT i.id, i.sku, i.name, i.tracking_type AS "trackingType", i.min_stock AS "minStock", i.is_active AS "isActive", i.photo_path AS "photoPath",
           c.name AS "categoryName", u.code AS "unitCode",
           COALESCE(SUM(b.quantity), 0)::int AS "onHand",
           (SELECT COUNT(*)::int FROM assets a WHERE a.item_id = i.id AND a.status <> 'RETIRED' ${assetLocFilter}) AS "assetCount"
    FROM items i
    JOIN units u ON u.id = i.unit_id
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN stock_balances b ON b.item_id = i.id ${locFilter}
    WHERE ${Prisma.join(where, " AND ")}
    GROUP BY i.id, c.name, u.code
    ${having}`;

  const [rows, total] = await Promise.all([
    prisma.$queryRaw<
      Omit<ItemRow, "stockStatus">[]
    >`${base} ORDER BY i.name, i.sku LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM (${base}) t`,
  ]);
  return {
    rows: rows.map((r) => ({
      ...r,
      stockStatus: r.trackingType === "STOCK" ? stockStatus(r.onHand, r.minStock) : null,
    })),
    total: total[0].n,
    page,
    pageCount: Math.max(1, Math.ceil(total[0].n / pageSize)),
  };
}

/** Item detail: balances per visible location and recent ledger lines. */
export async function getItem(actor: AccessUser, id: string) {
  const scope = requireAccess(actor, "records.view");
  const locs = scopeLocations(scope);
  const item = await prisma.item.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      unit: { select: { id: true, code: true, name: true } },
      identifiers: { where: { isActive: true }, select: { id: true, namespace: true, code: true, kind: true } },
    },
  });
  if (!item) throw errors.notFound("item");
  const locWhere = locs ? { locationId: { in: locs } } : {};
  const [balances, movements, assetCount] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { itemId: id, ...locWhere },
      select: { quantity: true, location: { select: { id: true, code: true, name: true } } },
      orderBy: { location: { code: "asc" } },
    }),
    prisma.stockMovement.findMany({
      where: { itemId: id, ...locWhere },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        quantity: true,
        balanceAfter: true,
        createdAt: true,
        location: { select: { code: true, name: true } },
        transaction: {
          select: {
            id: true,
            reference: true,
            type: true,
            recipientName: true,
            reason: true,
            source: true,
            actor: { select: { name: true } },
          },
        },
      },
    }),
    prisma.asset.count({ where: { itemId: id, status: { not: "RETIRED" }, ...locWhere } }),
  ]);
  const onHand = balances.reduce((s, b) => s + b.quantity, 0);
  return {
    ...item,
    balances,
    movements,
    assetCount,
    onHand,
    stockStatus: item.trackingType === "STOCK" ? stockStatus(onHand, item.minStock) : null,
    canManage: can(actor, "masterData.manage"),
  };
}

export async function listCatalog(actor: AccessUser) {
  requireAccess(actor, "records.view");
  const [categories, units] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } }),
    prisma.unit.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { items: true } } } }),
  ]);
  return { categories, units };
}

export async function createCategory(actor: AccessUser, input: { name: string }, ctx: Ctx) {
  requireAccess(actor, "masterData.manage");
  const data = parse(categorySchema, input);
  const dup = await prisma.category.findFirst({ where: { name: { equals: data.name, mode: "insensitive" } } });
  if (dup)
    throw new ApiError("DUPLICATE", `Category ${data.name} already exists.`, { fields: { name: ["Already exists."] } });
  return prisma.$transaction(async (tx) => {
    const c = await tx.category.create({ data });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "category.created",
      recordType: "category",
      recordId: c.id,
      after: data,
      requestId: ctx.requestId,
    });
    return c;
  });
}

export async function createUnit(actor: AccessUser, input: { code: string; name: string }, ctx: Ctx) {
  requireAccess(actor, "masterData.manage");
  const data = parse(unitSchema, input);
  const dup = await prisma.unit.findUnique({ where: { code: data.code } });
  if (dup)
    throw new ApiError("DUPLICATE", `Unit ${data.code} already exists.`, { fields: { code: ["Already exists."] } });
  return prisma.$transaction(async (tx) => {
    const u = await tx.unit.create({ data });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "unit.created",
      recordType: "unit",
      recordId: u.id,
      after: data,
      requestId: ctx.requestId,
    });
    return u;
  });
}
