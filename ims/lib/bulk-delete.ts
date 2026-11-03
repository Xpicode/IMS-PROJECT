import "server-only";
import { z } from "zod";
import { prisma, Prisma } from "@/lib/db/prisma";
import { json, readJson, route } from "@/lib/api/route";
import { ApiError, errors } from "@/lib/api/errors";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { updateItem } from "@/lib/inventory/items";
import { removeFile } from "@/lib/inventory/item-photo";
import { changeAssetStatus } from "@/lib/assets/service";
import { updateLocation } from "@/lib/locations/service";
import { updateUser } from "@/lib/users/service";
import type { Ctx } from "@/lib/context";

/**
 * "Select and delete" on the lists. A record nothing points at is deleted for good. A record
 * with history (stock moves, loans, counts, forms, audit entries) can't be: the database's
 * Restrict links refuse, the delete rolls back, and it is hidden (deactivated) instead, so its
 * history and forms stay correct. If even that isn't allowed, it is skipped with the reason.
 */
export type BulkResult = { deleted: string[]; hidden: string[]; skipped: { label: string; reason: string }[] };
export const MAX_BULK = 200;

const isLinked = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";

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

/**
 * Assets are never deleted: asset history is append-only (a database rule), and every asset has
 * at least its "Added" entry. "Delete" retires them instead; the list hides retired assets.
 */
export async function bulkDeleteAssets(actor: AccessUser, ids: string[], ctx: Ctx) {
  requireAccess(actor, "masterData.manage");
  if (ids.length > MAX_BULK) throw new ApiError("VALIDATION_FAILED", `Select ${MAX_BULK} or fewer at a time.`);
  const out: BulkResult = { deleted: [], hidden: [], skipped: [] };
  for (const id of new Set(ids)) {
    const a = await prisma.asset.findUnique({ where: { id }, select: { tag: true, version: true, status: true } });
    if (!a) {
      out.skipped.push({ label: id.slice(0, 8), reason: "It was not found." });
      continue;
    }
    if (a.status === "RETIRED") {
      out.hidden.push(a.tag);
      continue;
    }
    try {
      await changeAssetStatus(
        actor,
        id,
        {
          status: "RETIRED",
          reason: "Deleted from the list (assets are retired, so their history stays).",
          expectedVersion: a.version,
        },
        ctx,
      );
      out.hidden.push(a.tag);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      out.skipped.push({ label: a.tag, reason: e.message });
    }
  }
  return out;
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

const bulkBody = z.object({ ids: z.array(z.uuid()).min(1).max(MAX_BULK) });

/** POST /api/v1/<type>/bulk-delete  { ids } → BulkResult. */
export const bulkDeleteRoute = (fn: (actor: AccessUser, ids: string[], ctx: Ctx) => Promise<BulkResult>) =>
  route({ auth: true }, async ({ req, user, ctx }) => {
    const b = bulkBody.safeParse(await readJson(req));
    if (!b.success) throw new ApiError("VALIDATION_FAILED", `Select between 1 and ${MAX_BULK} rows.`);
    return json(await fn(user, b.data.ids, ctx));
  });
