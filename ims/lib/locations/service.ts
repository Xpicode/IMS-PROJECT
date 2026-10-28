import "server-only";
import { prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import type { Ctx } from "@/lib/context";
import {
  createLocationSchema,
  parse,
  updateLocationSchema,
  type CreateLocationInput,
  type UpdateLocationInput,
} from "@/lib/validation";

const publicLocation = {
  id: true,
  code: true,
  name: true,
  type: true,
  parentId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  parent: { select: { id: true, code: true, name: true } },
  _count: { select: { users: true, children: true } },
} as const;

/** Locations the user may see, sorted by code. */
export async function listLocations(actor: AccessUser, opts: { includeInactive?: boolean } = {}) {
  const scope = requireAccess(actor, "locations.view");
  return prisma.location.findMany({
    where: {
      ...(scope.scope === "global" ? {} : { id: { in: scope.locationIds } }),
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    select: publicLocation,
    orderBy: { code: "asc" },
  });
}

/** 404 (not 403) for locations outside the user's scope, so hidden records stay hidden (§12.3). */
export async function getLocation(actor: AccessUser, id: string) {
  if (!can(actor, "locations.view", id)) {
    requireAccess(actor, "locations.view"); // still 401/403 if the user can't view any location
    throw errors.notFound("location");
  }
  const loc = await prisma.location.findUnique({ where: { id }, select: publicLocation });
  if (!loc) throw errors.notFound("location");
  return loc;
}

export async function createLocation(actor: AccessUser, input: CreateLocationInput, ctx: Ctx) {
  const data = parse(createLocationSchema, input);
  // Top-level locations are admin-only; supervisors may add inside their own scope.
  if (data.parentId) requireAccess(actor, "locations.manage", data.parentId);
  else if (actor.role !== "ADMIN") throw errors.forbidden("add a top-level location");
  else requireAccess(actor, "locations.manage");

  if (data.parentId) {
    const parent = await prisma.location.findUnique({ where: { id: data.parentId }, select: { isActive: true } });
    if (!parent) throw errors.notFound("parent location");
    if (!parent.isActive) throw new ApiError("CONFLICT", "The parent location is inactive. Reactivate it first.");
  }
  const dup = await prisma.location.findUnique({ where: { code: data.code }, select: { id: true } });
  if (dup) {
    throw new ApiError("DUPLICATE", `The code ${data.code} is already used by another location.`, {
      fields: { code: ["This code is already in use."] },
    });
  }

  return prisma.$transaction(async (tx) => {
    const loc = await tx.location.create({
      data: { code: data.code, name: data.name, type: data.type, parentId: data.parentId ?? null },
      select: publicLocation,
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "location.created",
      recordType: "location",
      recordId: loc.id,
      after: { code: loc.code, name: loc.name, type: loc.type, parentId: loc.parentId },
      requestId: ctx.requestId,
    });
    return loc;
  });
}

export async function updateLocation(actor: AccessUser, id: string, input: UpdateLocationInput, ctx: Ctx) {
  const patch = parse(updateLocationSchema, input);
  await getLocation(actor, id); // 404 if hidden
  requireAccess(actor, "locations.manage", id);

  return prisma.$transaction(async (tx) => {
    const before = await tx.location.findUniqueOrThrow({
      where: { id },
      select: { name: true, type: true, isActive: true },
    });
    if (patch.isActive === false) {
      const activeChildren = await tx.location.count({ where: { parentId: id, isActive: true } });
      if (activeChildren > 0) {
        throw new ApiError("CONFLICT", "This location still has active locations inside it. Deactivate those first.");
      }
    }
    const loc = await tx.location.update({ where: { id }, data: patch, select: publicLocation });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "location.updated",
      recordType: "location",
      recordId: id,
      before,
      after: patch,
      requestId: ctx.requestId,
    });
    return loc;
  });
}
