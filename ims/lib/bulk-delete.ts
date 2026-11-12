import "server-only";
import { z } from "zod";
import { prisma, Prisma } from "@/lib/db/prisma";
import { json, readJson, route } from "@/lib/api/route";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { updateItem } from "@/lib/inventory/items";
import { removeFile } from "@/lib/inventory/item-photo";
import { updateLocation } from "@/lib/locations/service";
import { updateUser } from "@/lib/users/service";
import { cancelCountSession } from "@/lib/counts/service";
import type { Ctx } from "@/lib/context";

/**
 * "Select and delete" on the lists. A record nothing points at is deleted for good. A record
 * with history (stock moves, loans, counts, forms, audit entries) can't be: the database's
 * Restrict links refuse, the delete rolls back, and it is hidden (deactivated) instead, so its
 * history and forms stay correct. If even that isn't allowed, it is skipped with the reason.
 */
export type BulkResult = { deleted: string[]; hidden: string[]; skipped: { label: string; reason: string }[] };
export const MAX_BULK = 200;

/** Thrown by a remove step for a record that must keep its history even where no database link refuses. */
class KeepHistory extends Error {}
const isLinked = (e: unknown) =>
  e instanceof KeepHistory || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003");

async function run(
  ids: string[],
  label: (id: string) => Promise<string | null>,
  remove: (tx: Prisma.TransactionClient, id: string) => Promise<void>,
  hide: (id: string) => Promise<void>,
): Promise<BulkResult> {
  if (ids.length > MAX_BULK) throw new ApiError("VALIDATION_FAILED", `Select ${MAX_BULK} or fewer at a time.`);
  const out: BulkResult = { deleted: [], hidden: [], skipped: [] };
  for (const id of new Set(ids)) {
    const name = await label(id);
    if (!name) {
      out.skipped.push({ label: id.slice(0, 8), reason: "It was not found." });
      continue;
    }
    try {
      await prisma.$transaction((tx) => remove(tx, id));
      out.deleted.push(name);
    } catch (e) {
      if (e instanceof ApiError) {
        out.skipped.push({ label: name, reason: e.message });
        continue;
      }
      if (!isLinked(e)) throw e;
      try {
        await hide(id);
        out.hidden.push(name);
      } catch (h) {
        if (!(h instanceof ApiError)) throw h;
        out.skipped.push({ label: name, reason: h.message });
      }
    }
  }
  return out;
}

const audit = (
  tx: Prisma.TransactionClient,
  actor: AccessUser,
  ctx: Ctx,
  type: string,
  id: string,
  before: Record<string, unknown>,
) =>
  writeAudit(tx, {
    actorId: actor.id,
    eventType: `${type}.deleted`,
    recordType: type,
    recordId: id,
    before,
    requestId: ctx.requestId,
  });

export async function bulkDeleteItems(actor: AccessUser, ids: string[], ctx: Ctx) {
  requireAccess(actor, "masterData.manage");
  const photos: string[] = [];
  const result = await run(
    ids,
    async (id) => (await prisma.item.findUnique({ where: { id }, select: { sku: true } }))?.sku ?? null,
    async (tx, id) => {
      const before = await tx.item.findUniqueOrThrow({
        where: { id },
        select: { sku: true, name: true, photoPath: true },
      });
      await tx.itemIdentifier.deleteMany({ where: { itemId: id } }); // its own barcodes go with it
      await tx.item.delete({ where: { id } });
      await audit(tx, actor, ctx, "item", id, before);
      if (before.photoPath) photos.push(before.photoPath);
    },
    (id) => updateItem(actor, id, { isActive: false }, ctx).then(() => undefined),
  );
  await Promise.all(photos.map(removeFile)); // after commit: files of items that are gone
  return result;
}

export async function bulkDeleteLocations(actor: AccessUser, ids: string[], ctx: Ctx) {
  return run(
    ids,
    async (id) => (await prisma.location.findUnique({ where: { id }, select: { code: true } }))?.code ?? null,
    async (tx, id) => {
      requireAccess(actor, "locations.manage", id);
      const before = await tx.location.findUniqueOrThrow({
        where: { id },
        select: { code: true, name: true, type: true },
      });
      await tx.location.delete({ where: { id } }); // people assigned, stock, places inside it, or history block this
      await audit(tx, actor, ctx, "location", id, before);
    },
    (id) => updateLocation(actor, id, { isActive: false }, ctx).then(() => undefined),
  );
}

export async function bulkDeleteUsers(actor: AccessUser, ids: string[], ctx: Ctx) {
  requireAccess(actor, "settings.manage");
  return run(
    ids,
    async (id) => (await prisma.user.findUnique({ where: { id }, select: { email: true } }))?.email ?? null,
    async (tx, id) => {
      if (id === actor.id) throw errors.forbidden("delete your own account");
      const before = await tx.user.findUniqueOrThrow({
        where: { id },
        select: { email: true, name: true, role: true },
      });
      // Their own setup goes with them; anything they did (audit entries, forms, counts) blocks this.
      await tx.userLocation.deleteMany({ where: { userId: id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } }); // sign-in sessions cascade
      await audit(tx, actor, ctx, "user", id, before);
    },
    (id) => updateUser(actor, id, { status: "INACTIVE" }, ctx).then(() => undefined),
  );
}

/**
 * Counts: one with nothing counted or decided yet is deleted (its lines and counters go with it).
 * Counted numbers and decisions are kept for good, so an open count that has them is cancelled
 * instead (which also unfreezes its location), and a closed one is left as it is.
 */
export async function bulkDeleteCounts(actor: AccessUser, ids: string[], ctx: Ctx) {
  requireAccess(actor, "counts.create");
  return run(
    ids,
    async (id) => {
      const s = await prisma.countSession.findUnique({ where: { id }, select: { reference: true, locationId: true } });
      return s && can(actor, "records.view", s.locationId) ? s.reference : null;
    },
    async (tx, id) => {
      const before = await tx.countSession.findUniqueOrThrow({
        where: { id },
        select: { reference: true, name: true, status: true, locationId: true },
      });
      requireAccess(actor, "counts.create", before.locationId);
      await tx.countSession.delete({ where: { id } }); // counts sent or decisions made block this
      await audit(tx, actor, ctx, "count_session", id, before);
    },
    (id) => cancelCountSession(actor, id, ctx),
  );
}

/**
 * Closed tab: a cancelled request (nothing was released) is deleted for good. A closed loan
 * is hidden instead: its BOR-/RET- stock moves, forms and return records are permanent.
 */
export async function bulkDeleteBorrowings(actor: AccessUser, ids: string[], ctx: Ctx) {
  requireAccess(actor, "custody.confirm");
  return run(
    ids,
    async (id) => {
      const b = await prisma.borrowing.findUnique({
        where: { id },
        select: { reference: true, borrowerName: true, locationId: true },
      });
      return b && can(actor, "records.view", b.locationId) ? (b.reference ?? `request for ${b.borrowerName}`) : null;
    },
    async (tx, id) => {
      const before = await tx.borrowing.findUniqueOrThrow({
        where: { id },
        select: { reference: true, status: true, borrowerName: true, locationId: true },
      });
      requireAccess(actor, "custody.confirm", before.locationId);
      if (before.status === "CLOSED") throw new KeepHistory();
      if (before.status !== "CANCELLED")
        throw new ApiError("CONFLICT", "Only closed loans and cancelled requests can be deleted.");
      await tx.borrowing.delete({ where: { id } }); // its request lines go with it
      await audit(tx, actor, ctx, "borrowing", id, before);
    },
    (id) =>
      prisma.$transaction(async (tx) => {
        const b = await tx.borrowing.update({ where: { id }, data: { hiddenAt: new Date() } });
        await writeAudit(tx, {
          actorId: actor.id,
          eventType: "borrowing.hidden",
          recordType: "borrowing",
          recordId: id,
          after: { reference: b.reference },
          requestId: ctx.requestId,
        });
      }),
  );
}

const bulkBody = z.object({ ids: z.array(z.uuid()).min(1).max(MAX_BULK) });

/** POST /api/v1/<type>/bulk-delete  { ids } → BulkResult. */
export const bulkDeleteRoute = (fn: (actor: AccessUser, ids: string[], ctx: Ctx) => Promise<BulkResult>) =>
  route({ auth: true }, async ({ req, user, ctx }) => {
    const b = bulkBody.safeParse(await readJson(req));
    if (!b.success) throw new ApiError("VALIDATION_FAILED", `Select between 1 and ${MAX_BULK} rows.`);
    return json(await fn(user, b.data.ids, ctx));
  });
