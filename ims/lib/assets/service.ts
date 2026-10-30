import "server-only";
import { has } from "@/lib/db/search";
import { prisma, Prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import type { Ctx } from "@/lib/context";
import { nextNumber } from "@/lib/inventory/sequences";
import { scopeLocations } from "@/lib/inventory/items";
import { allowedNextStatuses, checkTransition, type TransitionVia } from "./transitions";
import {
  assetStatusSchema,
  changeAssetStatusSchema,
  createAssetsSchema,
  parse,
  updateAssetSchema,
  type ChangeAssetStatusInput,
  type CreateAssetsInput,
  type UpdateAssetInput,
  uuid,
} from "@/lib/validation";

const normSerial = (s: string) => s.trim().toUpperCase();

/**
 * "Add assets" with a quantity: N physical units of one ASSET-tracked item,
 * each with its own tag (PREFIX-0001…) and history (spec §6.2, A02).
 */
export async function createAssets(actor: AccessUser, input: CreateAssetsInput, ctx: Ctx) {
  const data = parse(createAssetsSchema, input);
  requireAccess(actor, "masterData.manage", data.locationId);
  if (data.serialNumbers.length > data.quantity) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `You entered ${data.serialNumbers.length} serial numbers for ${data.quantity} assets.`,
      {
        fields: { serialNumbers: ["Enter at most one serial number per asset."] },
      },
    );
  }
  const serials = data.serialNumbers.map(normSerial);

  return prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({
      where: { id: data.itemId },
      select: { id: true, sku: true, trackingType: true, isActive: true },
    });
    if (!item) throw errors.notFound("item");
    if (item.trackingType !== "ASSET") {
      throw new ApiError("VALIDATION_FAILED", `${item.sku} is counted stock. Only asset items get individual tags.`, {
        fields: { itemId: ["Pick an asset item."] },
      });
    }
    if (!item.isActive) throw new ApiError("CONFLICT", `${item.sku} is inactive.`);
    const loc = await tx.location.findUnique({
      where: { id: data.locationId },
      select: { isActive: true, code: true },
    });
    if (!loc) throw errors.notFound("location");
    if (!loc.isActive) throw new ApiError("CONFLICT", `${loc.code} is inactive. Pick another location.`);

    // Flag (don't block) serials already on another asset or repeated in this batch (§6.2).
    const warnings: string[] = [];
    const filled = serials.filter(Boolean);
    if (filled.length) {
      const existing = await tx.asset.findMany({
        where: { serialNumber: { in: filled, mode: "insensitive" } },
        select: { tag: true, serialNumber: true },
      });
      for (const e of existing) warnings.push(`Serial ${e.serialNumber} is already on ${e.tag}. Check the label.`);
      const seen = new Set<string>();
      for (const s of filled) {
        if (seen.has(s)) warnings.push(`Serial ${s} appears twice in this batch.`);
        seen.add(s);
      }
    }

    const assets = [];
    for (let i = 0; i < data.quantity; i++) {
      let tag = "";
      for (let tries = 0; tries < 1000; tries++) {
        const n = await nextNumber(tx, `TAG:${data.tagPrefix}`, 0);
        tag = `${data.tagPrefix}-${String(n).padStart(4, "0")}`;
        if (!(await tx.asset.findUnique({ where: { tag }, select: { id: true } }))) break;
      }
      const asset = await tx.asset.create({
        data: {
          tag,
          itemId: item.id,
          locationId: data.locationId,
          serialNumber: serials[i] || null,
          condition: data.condition,
          custodianName: data.custodianName,
          notes: data.notes,
          events: {
            create: {
              eventType: "CREATED",
              toStatus: "AVAILABLE",
              toLocationId: data.locationId,
              toCondition: data.condition,
              toCustodian: data.custodianName,
              notes: data.notes,
              actorId: actor.id,
              requestId: ctx.requestId,
            },
          },
        },
      });
      assets.push(asset);
    }
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "asset.created",
      recordType: "item",
      recordId: item.id,
      after: { item: item.sku, location: loc.code, tags: assets.map((a) => a.tag), warnings },
      requestId: ctx.requestId,
    });
    return { assets, warnings };
  });
}

/** Asset or 404 when it doesn't exist or sits outside the user's locations (§12.3). */
async function visibleAsset(actor: AccessUser, id: string) {
  const a = await prisma.asset.findUnique({ where: { id }, select: { id: true, locationId: true } });
  if (!a || !can(actor, "records.view", a.locationId)) {
    requireAccess(actor, "records.view");
    throw errors.notFound("asset");
  }
  return a;
}

const stale = () =>
  new ApiError("CONFLICT", "Someone else changed this asset a moment ago. Refresh to see the latest, then try again.");

/**
 * The ONLY way a status changes (§9.4): checks the transition map, the
 * expected version (no silent overwrites), and always writes an asset event.
 * Borrowing (Phase 5) calls this with via = "release" / "return".
 */
export async function changeAssetStatus(
  actor: AccessUser,
  id: string,
  input: ChangeAssetStatusInput,
  ctx: Ctx,
  via: TransitionVia = "manual",
  db?: Prisma.TransactionClient,
) {
  const data = parse(changeAssetStatusSchema, input);
  const v = await visibleAsset(actor, id);
  requireAccess(actor, via === "manual" ? "masterData.manage" : "custody.confirm", v.locationId);

  const run = async (tx: Prisma.TransactionClient) => {
    const [cur] = await tx.$queryRaw<{ status: string; version: number }[]>`
      SELECT status::text, version FROM assets WHERE id = ${id}::uuid FOR UPDATE`;
    if (cur.version !== data.expectedVersion) throw stale();
    const why = checkTransition(cur.status as never, data.status, via);
    if (why) throw new ApiError("CONFLICT", why);
    const asset = await tx.asset.update({
      where: { id },
      data: {
        status: data.status,
        version: { increment: 1 },
        events: {
          create: {
            eventType: "STATUS_CHANGED",
            fromStatus: cur.status as never,
            toStatus: data.status,
            notes: data.reason,
            actorId: actor.id,
            requestId: ctx.requestId,
          },
        },
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "asset.status_changed",
      recordType: "asset",
      recordId: id,
      before: { status: cur.status },
      after: { status: data.status, reason: data.reason, via },
      requestId: ctx.requestId,
    });
    return asset;
  };
  return db ? run(db) : prisma.$transaction(run);
}

export async function updateAsset(actor: AccessUser, id: string, input: UpdateAssetInput, ctx: Ctx) {
  const data = parse(updateAssetSchema, input);
  const v = await visibleAsset(actor, id);
  requireAccess(actor, "masterData.manage", v.locationId);
  return prisma.$transaction(async (tx) => {
    const [cur] = await tx.$queryRaw<
      { version: number }[]
    >`SELECT version FROM assets WHERE id = ${id}::uuid FOR UPDATE`;
    if (cur.version !== data.expectedVersion) throw stale();
    const before = await tx.asset.findUniqueOrThrow({ where: { id } });
    const patch = {
      serialNumber:
        data.serialNumber === undefined ? undefined : data.serialNumber ? normSerial(data.serialNumber) : null,
      condition: data.condition,
      custodianName: data.custodianName === undefined ? undefined : data.custodianName || null,
      notes: data.notes === undefined ? undefined : data.notes || null,
    };
    const changed = Object.entries(patch)
      .filter(([k, val]) => val !== undefined && val !== before[k as keyof typeof before])
      .map(([k]) => k);
    const asset = await tx.asset.update({
      where: { id },
      data: {
        ...patch,
        version: { increment: 1 },
        events: {
          create: {
            eventType: "DETAILS_CHANGED",
            fromCondition: patch.condition ? before.condition : undefined,
            toCondition: patch.condition,
            fromCustodian: patch.custodianName !== undefined ? before.custodianName : undefined,
            toCustodian: patch.custodianName ?? undefined,
            notes: changed.length ? `Changed: ${changed.join(", ")}` : "No changes",
            actorId: actor.id,
            requestId: ctx.requestId,
          },
        },
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "asset.updated",
      recordType: "asset",
      recordId: id,
      before: Object.fromEntries(changed.map((k) => [k, before[k as keyof typeof before]])),
      after: Object.fromEntries(changed.map((k) => [k, patch[k as keyof typeof patch]])),
      requestId: ctx.requestId,
    });
    return asset;
  });
}

export async function getAsset(actor: AccessUser, id: string) {
  await visibleAsset(actor, id);
  const a = await prisma.asset.findUniqueOrThrow({
    where: { id },
    include: {
      item: { select: { id: true, sku: true, name: true } },
      location: { select: { id: true, code: true, name: true } },
      events: { orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { name: true } } } },
    },
  });
  const locIds = [...new Set(a.events.flatMap((e) => [e.fromLocationId, e.toLocationId]).filter(Boolean))] as string[];
  const locs = await prisma.location.findMany({ where: { id: { in: locIds } }, select: { id: true, code: true } });
  const codeOf = Object.fromEntries(locs.map((l) => [l.id, l.code]));
  const canManage = can(actor, "masterData.manage", a.locationId);
  return {
    ...a,
    events: a.events.map((e) => ({
      ...e,
      fromLocationCode: e.fromLocationId ? codeOf[e.fromLocationId] : null,
      toLocationCode: e.toLocationId ? codeOf[e.toLocationId] : null,
    })),
    canManage,
    nextStatuses: canManage ? allowedNextStatuses(a.status, "manual") : [],
  };
}

export async function listAssets(
  actor: AccessUser,
  opts: { q?: string; status?: string; locationId?: string; itemId?: string; page?: number; pageSize?: number },
) {
  const scope = requireAccess(actor, "records.view");
  const locs = scopeLocations(scope);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));
  const q = opts.q?.trim().slice(0, 100);
  const where: Prisma.AssetWhereInput = {
    AND: [
      locs ? { locationId: { in: locs } } : {},
      // Filters from a URL: a malformed value is ignored (was a database error).
      uuid.safeParse(opts.locationId).success ? { locationId: opts.locationId } : {},
      uuid.safeParse(opts.itemId).success ? { itemId: opts.itemId } : {},
      assetStatusSchema.safeParse(opts.status).success ? { status: opts.status as never } : {},
      q
        ? {
            OR: [{ tag: has(q) }, { serialNumber: has(q) }, { item: { name: has(q) } }, { item: { sku: has(q) } }],
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: { item: { select: { sku: true, name: true } }, location: { select: { code: true, name: true } } },
      orderBy: { tag: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.asset.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
