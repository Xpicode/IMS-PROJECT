import "server-only";
import { prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { labelPayload } from "@/lib/codes";
import { loadAccessUser } from "@/lib/users/access";
import { nextReference } from "@/lib/inventory/sequences";
import { scopeLocations } from "@/lib/inventory/items";
import type { Ctx } from "@/lib/context";
import { createCountSchema, parse, type CreateCountInput } from "@/lib/validation";

/** Asset statuses that are physically expected at the location during a count. */
const COUNTABLE_ASSET = ["AVAILABLE", "UNDER_MAINTENANCE", "NEEDS_REVIEW"] as const;

/**
 * Create a count session (§7.7 step 1): snapshot expected quantities from the
 * live balances and list the assets expected at the location. The snapshot is
 * for the reviewer only; devices never receive it (blind count).
 * shortcut: scope is "everything at this location"; picking items/categories comes with Phase 4.
 */
export async function createCountSession(actor: AccessUser, input: CreateCountInput, ctx: Ctx) {
  const data = parse(createCountSchema, input);
  requireAccess(actor, "counts.create", data.locationId);
  const assigneeIds = [...new Set(data.assigneeIds)];
  for (const id of assigneeIds) {
    const u = await loadAccessUser(id);
    if (!u || u.status !== "ACTIVE" || !can(u, "counts.perform", data.locationId)) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "One of the people you picked can't count at this location. Pick someone assigned to it.",
        {
          fields: { assigneeIds: ["Pick people who can count here."] },
        },
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const loc = await tx.location.findUnique({
      where: { id: data.locationId },
      select: { id: true, code: true, isActive: true },
    });
    if (!loc) throw errors.notFound("location");
    if (!loc.isActive) throw new ApiError("CONFLICT", `${loc.code} is inactive. Pick another location.`);

    const stock = data.includeStock
      ? await tx.stockBalance.findMany({
          where: { locationId: loc.id, item: { isActive: true, trackingType: "STOCK" } },
          select: { itemId: true, quantity: true },
        })
      : [];
    const assets = data.includeAssets
      ? await tx.asset.findMany({
          where: { locationId: loc.id, status: { in: [...COUNTABLE_ASSET] } },
          select: { id: true, itemId: true, status: true },
        })
      : [];
    if (stock.length + assets.length === 0) {
      throw new ApiError(
        "VALIDATION_FAILED",
        `There is nothing to count at ${loc.code} yet. Receive stock or add assets there first.`,
        {
          fields: { includeStock: ["Nothing to count here."] },
        },
      );
    }

    const session = await tx.countSession.create({
      data: {
        reference: await nextReference(tx, "CNT"),
        name: data.name,
        locationId: loc.id,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        notes: data.notes,
        createdById: actor.id,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
        targets: {
          create: [
            ...stock.map((b) => ({ kind: "STOCK" as const, itemId: b.itemId, expectedQuantity: b.quantity })),
            ...assets.map((a) => ({
              kind: "ASSET" as const,
              itemId: a.itemId,
              assetId: a.id,
              expectedStatus: a.status,
            })),
          ],
        },
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "count.created",
      recordType: "count_session",
      recordId: session.id,
      after: {
        reference: session.reference,
        location: loc.code,
        stock: stock.length,
        assets: assets.length,
        assignees: assigneeIds.length,
      },
      requestId: ctx.requestId,
    });
    return session;
  });
}

export async function closeCountSession(actor: AccessUser, id: string, ctx: Ctx) {
  const s = await prisma.countSession.findUnique({
    where: { id },
    select: { locationId: true, status: true, reference: true },
  });
  if (!s || !can(actor, "records.view", s.locationId)) throw errors.notFound("count session");
  requireAccess(actor, "counts.create", s.locationId);
  if (s.status !== "OPEN") throw new ApiError("CONFLICT", `${s.reference} is already closed.`);
  return prisma.$transaction(async (tx) => {
    const r = await tx.countSession.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date(), version: { increment: 1 } },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "count.closed",
      recordType: "count_session",
      recordId: id,
      requestId: ctx.requestId,
    });
    return r;
  });
}

export async function listCountSessions(actor: AccessUser, opts: { status?: "OPEN" | "CLOSED"; page?: number }) {
  const scope = requireAccess(actor, "records.view");
  const locs = scopeLocations(scope);
  const page = Math.max(1, opts.page ?? 1);
  const where = { ...(locs ? { locationId: { in: locs } } : {}), ...(opts.status ? { status: opts.status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.countSession.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * 50,
      take: 50,
      select: {
        id: true,
        reference: true,
        name: true,
        status: true,
        dueAt: true,
        createdAt: true,
        location: { select: { id: true, code: true, name: true } },
        assignees: { select: { user: { select: { name: true } } } },
        _count: { select: { targets: true, entries: true } },
      },
    }),
    prisma.countSession.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / 50)) };
}

/** Open sessions assigned to this user at locations they can still count at. */
export async function listMyAssignments(actor: AccessUser) {
  if (actor.status !== "ACTIVE") throw errors.inactive();
  const rows = await prisma.countSession.findMany({
    where: { status: "OPEN", assignees: { some: { userId: actor.id } } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: {
      id: true,
      reference: true,
      name: true,
      dueAt: true,
      version: true,
      location: { select: { id: true, code: true, name: true } },
      _count: { select: { targets: true } },
    },
  });
  return rows
    .filter((r) => can(actor, "counts.perform", r.location.id))
    .map(({ _count, ...r }) => ({ ...r, targetCount: _count.targets }));
}

export type BootstrapTarget = {
  id: string;
  kind: "STOCK" | "ASSET";
  version: number;
  item: { id: string; sku: string; name: string; unit: string };
  asset: { id: string; tag: string; serialNumber: string | null; status: string; condition: string } | null;
};

/**
 * Download scope for one assignment (§11.3): the session, what to count, and
 * every code that should find each target offline. Only safe fields: no
 * expected quantities, no other users, no costs.
 */
export async function bootstrapSession(actor: AccessUser, sessionId: string) {
  requireAccess(actor, "records.view");
  const s = await prisma.countSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      dueAt: true,
      version: true,
      notes: true,
      location: { select: { id: true, code: true, name: true } },
      assignees: { where: { userId: actor.id }, select: { userId: true } },
    },
  });
  if (!s || s.assignees.length === 0 || !can(actor, "counts.perform", s.location.id))
    throw errors.notFound("count session");
  if (s.status !== "OPEN")
    throw new ApiError("CONFLICT", `${s.reference} is closed. Ask your supervisor if you still need to count.`);

  const targets = await prisma.countSessionItem.findMany({
    where: { sessionId },
    orderBy: [{ kind: "desc" }, { item: { name: "asc" } }],
    select: {
      id: true,
      kind: true,
      version: true,
      item: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: { select: { code: true } },
          identifiers: { where: { isActive: true }, select: { code: true } },
        },
      },
      asset: {
        select: {
          id: true,
          tag: true,
          serialNumber: true,
          status: true,
          condition: true,
          identifiers: { where: { isActive: true }, select: { code: true } },
        },
      },
    },
  });

  const identifiers: { code: string; targetId: string }[] = [];
  const out: BootstrapTarget[] = targets.map((t) => {
    if (t.kind === "STOCK") {
      for (const c of [t.item.sku, labelPayload("item", t.item.id), ...t.item.identifiers.map((i) => i.code)])
        identifiers.push({ code: c, targetId: t.id });
    } else if (t.asset) {
      for (const c of [t.asset.tag, labelPayload("asset", t.asset.id), ...t.asset.identifiers.map((i) => i.code)])
        identifiers.push({ code: c, targetId: t.id });
    }
    return {
      id: t.id,
      kind: t.kind,
      version: t.version,
      item: { id: t.item.id, sku: t.item.sku, name: t.item.name, unit: t.item.unit.code },
      asset: t.asset
        ? {
            id: t.asset.id,
            tag: t.asset.tag,
            serialNumber: t.asset.serialNumber,
            status: t.asset.status,
            condition: t.asset.condition,
          }
        : null,
    };
  });
  const { assignees: _a, ...session } = s;
  void _a;
  return { session, targets: out, identifiers, serverTime: new Date().toISOString() };
}
export type Bootstrap = Awaited<ReturnType<typeof bootstrapSession>>;

/** People who could be assigned to count at each location (for the New count form). */
export async function assignableUsers(actor: AccessUser, locationIds: string[]) {
  requireAccess(actor, "counts.create");
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const access = await Promise.all(users.map((u) => loadAccessUser(u.id)));
  return Object.fromEntries(
    locationIds.map((loc) => [
      loc,
      users
        .filter((_, i) => access[i] && can(access[i]!, "counts.perform", loc))
        .map((u) => ({ id: u.id, name: u.name, role: u.role })),
    ]),
  );
}
