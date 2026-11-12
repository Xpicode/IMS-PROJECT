import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma, type Prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { documentsDir } from "@/lib/documents/service";
import { MAX_PHOTO_BYTES, sniff } from "@/lib/inventory/item-photo";

export type EvidenceTarget = { kind: "COUNT" | "RETURN"; targetId: string; locationId?: string };

async function uploadLocation(actor: AccessUser, target: EvidenceTarget) {
  if (target.kind === "COUNT") {
    const t = await prisma.countSessionItem.findUnique({
      where: { id: target.targetId },
      include: { session: { include: { assignees: true } } },
    });
    if (!t || !t.session.assignees.some((a) => a.userId === actor.id)) throw errors.notFound("count target");
    requireAccess(actor, "counts.submit", t.session.locationId);
    return t.session.locationId;
  }
  const line = await prisma.borrowingLine.findUnique({ where: { id: target.targetId }, include: { borrowing: true } });
  if (!line || !can(actor, "records.view", line.borrowing.locationId)) throw errors.notFound("loan line");
  const locationId = target.locationId ?? line.borrowing.locationId;
  requireAccess(actor, "custody.confirm", locationId);
  return locationId;
}

/** Stable UUID + identical bytes is a replay; neither bytes nor target may be replaced. */
export async function uploadEvidence(actor: AccessUser, id: string, target: EvidenceTarget, bytes: Uint8Array) {
  const locationId = await uploadLocation(actor, target);
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES)
    throw new ApiError("VALIDATION_FAILED", "Use a photo no larger than 2 MB.");
  const kind = sniff(bytes);
  if (!kind) throw new ApiError("VALIDATION_FAILED", "Use a JPEG, PNG or WebP photo.");
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error", animated: false });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error("Invalid image");
    await image.stats();
  } catch {
    throw new ApiError("VALIDATION_FAILED", "This photo could not be decoded. Choose a valid JPEG, PNG or WebP.");
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"evidence:" + id}, 0))`;
    const seen = await tx.evidencePhoto.findUnique({ where: { id } });
    if (
      seen &&
      (seen.ownerId !== actor.id ||
        seen.targetKind !== target.kind ||
        seen.targetId !== target.targetId ||
        seen.locationId !== locationId ||
        seen.sha256 !== hash)
    ) {
      throw new ApiError("CONFLICT", "This photo ID was already used for different evidence.");
    }
    const rel = `evidence/${id}-${hash}.${kind.ext}`;
    const file = path.join(/*turbopackIgnore: true*/ documentsDir(), rel);
    await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
    if (seen) {
      const stored = await readFile(/*turbopackIgnore: true*/ file);
      if (createHash("sha256").update(stored).digest("hex") !== hash)
        throw new ApiError("CONFLICT", "Stored photo integrity check failed.");
    } else {
      // Publish only a complete file. A crash before the DB commit can be retried safely.
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(/*turbopackIgnore: true*/ temporary, bytes, { flag: "wx" });
        await rename(/*turbopackIgnore: true*/ temporary, file);
      } finally {
        await rm(/*turbopackIgnore: true*/ temporary, { force: true });
      }
    }
    if (!seen)
      await tx.evidencePhoto.create({
        data: {
          id,
          ownerId: actor.id,
          targetKind: target.kind,
          targetId: target.targetId,
          locationId,
          sha256: hash,
          sizeBytes: bytes.length,
          contentType: kind.type,
          filePath: rel,
        },
      });
    return { id };
  });
}

/** Called inside the record transaction; missing uploads must remain retryable. */
export async function checkEvidence(
  tx: Prisma.TransactionClient,
  actorId: string,
  target: EvidenceTarget,
  ids: string[],
) {
  if (ids.length > 3 || new Set(ids).size !== ids.length)
    throw new ApiError("VALIDATION_FAILED", "Use up to three different photos per item.");
  const photos = await tx.evidencePhoto.findMany({ where: { id: { in: ids } } });
  if (photos.length !== ids.length)
    throw new ApiError("CONFLICT", "Some photos have not uploaded yet. Retry the upload before submitting.");
  for (const p of photos) {
    if (
      p.ownerId !== actorId ||
      p.targetKind !== target.kind ||
      p.targetId !== target.targetId ||
      p.locationId !== target.locationId
    )
      throw errors.forbidden("attach this evidence");
    // Do not acknowledge a record if the evidence file is missing from storage.
    const bytes = await readFile(/*turbopackIgnore: true*/ path.join(documentsDir(), p.filePath));
    if (createHash("sha256").update(bytes).digest("hex") !== p.sha256)
      throw new Error("Evidence integrity check failed");
  }
}

export async function viewEvidence(actor: AccessUser, id: string) {
  const p = await prisma.evidencePhoto.findUnique({
    where: { id },
    include: {
      counts: { include: { entry: { include: { session: true } } } },
      returns: {
        include: { line: { include: { borrowing: true, returnLines: { include: { return: true } } } } },
      },
    },
  });
  if (!p) throw errors.notFound("photo");
  const countAccess = p.counts.some(({ entry }) => can(actor, "counts.approve", entry.session.locationId));
  const returnAccess = p.returns.some(
    ({ line }) =>
      line.returnLines.length > 0 &&
      can(actor, "records.view", line.borrowing.locationId) &&
      line.returnLines.every((r) => can(actor, "records.view", r.return.locationId)) &&
      (actor.role !== "FIELD" || line.borrowing.preparedById === actor.id),
  );
  const ownUpload =
    p.ownerId === actor.id && can(actor, p.targetKind === "COUNT" ? "counts.submit" : "custody.confirm", p.locationId);
  if (!countAccess && !returnAccess && !ownUpload) throw errors.notFound("photo");
  const bytes = await readFile(/*turbopackIgnore: true*/ path.join(documentsDir(), p.filePath)).catch(() => null);
  if (!bytes) throw errors.notFound("photo");
  if (createHash("sha256").update(bytes).digest("hex") !== p.sha256) throw errors.notFound("photo");
  return { bytes, type: p.contentType };
}
