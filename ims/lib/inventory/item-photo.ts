import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { documentsDir } from "@/lib/documents/service";
import type { Ctx } from "@/lib/context";

/** The browser shrinks photos to ~1280 px before upload; this cap is for anything else. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Type from the file's first bytes (never trust the name or the Content-Type). */
function sniff(b: Uint8Array): { type: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "image/png", ext: "png" };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { type: "image/webp", ext: "webp" };
  return null;
}
const TYPE_OF: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** A stored path, resolved inside the private folder only (whatever the database says). */
function inside(rel: string) {
  const base = path.resolve(/*turbopackIgnore: true*/ documentsDir());
  const file = path.resolve(/*turbopackIgnore: true*/ base, rel);
  return file.startsWith(base + path.sep) ? file : null;
}
const removeFile = (rel: string | null) => {
  const f = rel && inside(rel);
  return f ? rm(/*turbopackIgnore: true*/ f, { force: true }).catch(() => undefined) : undefined;
};

/** Add or replace an item's photo (same permission as editing the item). */
export async function setItemPhoto(actor: AccessUser, id: string, bytes: Uint8Array, ctx: Ctx) {
  requireAccess(actor, "masterData.manage");
  if (bytes.length > MAX_PHOTO_BYTES) throw new ApiError("VALIDATION_FAILED", "The photo is larger than 2 MB.");
  const kind = sniff(bytes);
  if (!kind) throw new ApiError("VALIDATION_FAILED", "Use a JPEG, PNG or WebP photo.");
  const before = await prisma.item.findUnique({ where: { id }, select: { photoPath: true } });
  if (!before) throw errors.notFound("item");

  const rel = `item-photos/${id}-${Date.now()}.${kind.ext}`;
  const file = inside(rel)!;
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ file, bytes);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.item.update({ where: { id }, data: { photoPath: rel } });
      await writeAudit(tx, {
        actorId: actor.id,
        eventType: "item.photo_changed",
        recordType: "item",
        recordId: id,
        before: { photoPath: before.photoPath },
        after: { photoPath: rel, bytes: bytes.length },
        requestId: ctx.requestId,
      });
    });
  } catch (e) {
    await removeFile(rel);
    throw e;
  }
  await removeFile(before.photoPath);
  return { photoPath: rel };
}

export async function removeItemPhoto(actor: AccessUser, id: string, ctx: Ctx) {
  requireAccess(actor, "masterData.manage");
  const before = await prisma.item.findUnique({ where: { id }, select: { photoPath: true } });
  if (!before) throw errors.notFound("item");
  if (!before.photoPath) return;
  await prisma.$transaction(async (tx) => {
    await tx.item.update({ where: { id }, data: { photoPath: null } });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "item.photo_changed",
      recordType: "item",
      recordId: id,
      before: { photoPath: before.photoPath },
      after: { photoPath: null },
      requestId: ctx.requestId,
    });
  });
  await removeFile(before.photoPath);
}

/** The photo's bytes for anyone who can see items. */
export async function itemPhoto(actor: AccessUser, id: string) {
  requireAccess(actor, "records.view");
  const item = await prisma.item.findUnique({ where: { id }, select: { photoPath: true } });
  const file = item?.photoPath ? inside(item.photoPath) : null;
  const bytes = file ? await readFile(/*turbopackIgnore: true*/ file).catch(() => null) : null;
  if (!item?.photoPath || !bytes) throw errors.notFound("photo");
  return { bytes: new Uint8Array(bytes), type: TYPE_OF[path.extname(item.photoPath).slice(1)] ?? "image/jpeg" };
}
