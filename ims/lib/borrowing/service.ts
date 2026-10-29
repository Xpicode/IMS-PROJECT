import "server-only";
import { has, hasCode } from "@/lib/db/search";
import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { withIdempotency } from "@/lib/idempotency";
import { checkTransition, type AssetStatus } from "@/lib/assets/transitions";
import { nextReference } from "@/lib/inventory/sequences";
import { normalizeCode } from "@/lib/codes";
import { documentForBorrowing, documentForReturn, renderIfPending } from "@/lib/documents/service";
import type { Ctx } from "@/lib/context";
import {
  borrowDraftSchema,
  parse,
  releaseSchema,
  returnSchema,
  type BorrowDraftInput,
  type ReleaseInput,
  type ReturnInput,
} from "@/lib/validation";

/**
 * Borrowing and returns of individual assets (spec §7.5–7.6, §9.3).
 * Release and return each run in ONE transaction with the asset rows locked in
 * a fixed order; the database also refuses a second open loan line for the same
 * asset, so two competing releases can never both succeed (A08).
 */
type Tx = Prisma.TransactionClient;

const STATUS_WORD: Record<string, string> = {
  AVAILABLE: "available",
  BORROWED: "already borrowed",
  UNDER_MAINTENANCE: "under maintenance",
  NEEDS_REVIEW: "waiting for review",
  LOST: "marked lost",
  RETIRED: "retired",
};

type LockedAsset = {
  id: string;
  tag: string;
  status: AssetStatus;
  location_id: string;
  condition: "GOOD" | "FAIR" | "DAMAGED";
  custodian_name: string | null;
};

async function lockAssets(tx: Tx, ids: string[]) {
  const rows = await tx.$queryRaw<LockedAsset[]>`
    SELECT id, tag, status::text AS status, location_id, condition::text AS condition, custodian_name
    FROM assets WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  return new Map(rows.map((r) => [r.id, r]));
}

/** A field user (or anyone) prepares a loan: no number, nothing changes until a supervisor releases it. */
export async function createBorrowDraft(
  actor: AccessUser,
  input: BorrowDraftInput,
  ctx: Ctx,
  key: string = randomUUID(),
) {
  const data = parse(borrowDraftSchema, input);
  requireAccess(actor, "drafts.prepare", data.locationId);
  const tags = [...new Set(data.assetTags.map((t) => normalizeCode(t)))];
  const byTag = tags.length
    ? await prisma.asset.findMany({ where: { tag: { in: tags } }, select: { id: true, tag: true } })
    : [];
  const unknown = tags.filter((t) => !byTag.some((a) => a.tag === t));
  if (unknown.length) {
    throw new ApiError("VALIDATION_FAILED", `No asset has the tag ${unknown.join(", ")}. Check the label.`, {
      fields: { assetTags: [`Unknown tag: ${unknown.join(", ")}`] },
    });
  }
  const ids = [...new Set([...data.assetIds, ...byTag.map((a) => a.id)])];
  const found = await prisma.asset.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw errors.notFound("asset");
  const r = await withIdempotency<{ id: string }>(
    { userId: actor.id, key, scope: "POST /api/v1/borrowings", payload: data },
    async (tx) => {
      const b = await tx.borrowing.create({
        data: {
          status: "DRAFT",
          locationId: data.locationId,
          borrowerName: data.borrowerName,
          borrowerDept: data.borrowerDept,
          purpose: data.purpose,
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          receivedByName: data.receivedByName,
          notes: data.notes,
          preparedById: actor.id,
          lines: { create: ids.map((assetId) => ({ assetId })) },
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        eventType: "borrowing.drafted",
        recordType: "borrowing",
        recordId: b.id,
        after: { borrower: b.borrowerName, assets: ids.length },
        requestId: ctx.requestId,
      });
      return { status: 201, body: { id: b.id } };
    },
  );
  return r.body;
}

export type ReleaseResult = { id: string; reference: string; documentId: string; assets: string[] };

/** Confirm a release (§7.5 steps 3–5): loan OPEN with a BOR- number, assets BORROWED, events, audit, form. */
export async function releaseBorrowing(actor: AccessUser, input: ReleaseInput, ctx: Ctx, key: string) {
  const data = parse(releaseSchema, input);
  requireAccess(actor, "custody.confirm", data.locationId);
  const ids = data.lines.map((l) => l.assetId);
  if (new Set(ids).size !== ids.length) throw new ApiError("VALIDATION_FAILED", "The same asset is listed twice.");

  const result = await withIdempotency<ReleaseResult>(
    { userId: actor.id, key, scope: "POST /api/v1/borrowings/release", payload: data },
    async (tx) => {
      const loc = await tx.location.findUnique({
        where: { id: data.locationId },
        select: { id: true, code: true, isActive: true },
      });
      if (!loc) throw errors.notFound("location");
      if (!loc.isActive) throw new ApiError("CONFLICT", `${loc.code} is inactive.`);

      let draft: { id: string; preparedById: string } | null = null;
      if (data.draftId) {
        const [d] = await tx.$queryRaw<{ id: string; status: string; location_id: string; prepared_by_id: string }[]>`
          SELECT id, status::text AS status, location_id, prepared_by_id FROM borrowings WHERE id = ${data.draftId}::uuid FOR UPDATE`;
        if (!d || d.location_id !== loc.id) throw errors.notFound("borrowing request");
        if (d.status !== "DRAFT") throw new ApiError("CONFLICT", "This request was already released or cancelled.");
        draft = { id: d.id, preparedById: d.prepared_by_id };
      }

      const assets = await lockAssets(tx, ids);
      const problems: string[] = [];
      for (const id of ids) {
        const a = assets.get(id);
        if (!a) throw errors.notFound("asset");
        if (a.location_id !== loc.id) problems.push(`${a.tag} is not at ${loc.code}`);
        else if (a.status !== "AVAILABLE")
          problems.push(`${a.tag} is ${STATUS_WORD[a.status] ?? a.status.toLowerCase()}`);
      }
      const open = await tx.borrowingLine.findMany({
        where: { assetId: { in: ids }, status: "OUT" },
        select: { asset: { select: { tag: true } } },
      });
      for (const o of open) problems.push(`${o.asset.tag} is already out on another loan`);
      if (problems.length) {
        throw new ApiError("CONFLICT", `Can't release: ${[...new Set(problems)].join("; ")}. Remove it from the list.`);
      }

      const now = new Date();
      const reference = await nextReference(tx, "BOR");
      const header = {
        status: "OPEN" as const,
        reference,
        borrowerName: data.borrowerName,
        borrowerDept: data.borrowerDept ?? null,
        purpose: data.purpose,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        receivedByName: data.receivedByName ?? null,
        notes: data.notes ?? null,
        releasedById: actor.id,
        releasedAt: now,
      };
      let loanId: string;
      if (draft) {
        // The supervisor's final list replaces whatever the draft had.
        await tx.borrowingLine.deleteMany({ where: { borrowingId: draft.id } });
        await tx.borrowing.update({ where: { id: draft.id }, data: { ...header, version: { increment: 1 } } });
        loanId = draft.id;
      } else {
        loanId = (await tx.borrowing.create({ data: { ...header, locationId: loc.id, preparedById: actor.id } })).id;
      }
      for (const l of data.lines) {
        const a = assets.get(l.assetId)!;
        await tx.borrowingLine.create({
          data: {
            borrowingId: loanId,
            assetId: a.id,
            status: "OUT",
            conditionOut: l.condition,
            accessories: l.accessories,
          },
        });
        await tx.asset.update({
          where: { id: a.id },
          data: {
            status: "BORROWED",
            custodianName: data.borrowerName,
            condition: l.condition,
            version: { increment: 1 },
          },
        });
        await tx.assetEvent.create({
          data: {
            assetId: a.id,
            eventType: "BORROWED",
            fromStatus: a.status,
            toStatus: "BORROWED",
            fromCustodian: a.custodian_name,
            toCustodian: data.borrowerName,
            fromCondition: a.condition !== l.condition ? a.condition : undefined,
            toCondition: a.condition !== l.condition ? l.condition : undefined,
            notes: `Loan ${reference}: ${data.purpose}`,
            actorId: actor.id,
            requestId: ctx.requestId,
          },
        });
      }
      await writeAudit(tx, {
        actorId: actor.id,
        eventType: "borrowing.released",
        recordType: "borrowing",
        recordId: loanId,
        after: { reference, borrower: data.borrowerName, assets: data.lines.map((l) => assets.get(l.assetId)!.tag) },
        requestId: ctx.requestId,
      });
      const documentId = await documentForBorrowing(tx, loanId, reference, loc.id, actor.id);
      return {
        status: 201,
        body: { id: loanId, reference, documentId, assets: data.lines.map((l) => assets.get(l.assetId)!.tag) },
      };
    },
  );
  await renderIfPending(result.body.documentId);
  return result;
}

export type ReturnResult = {
  returnId: string;
  reference: string;
  documentId: string;
  loanStatus: "OPEN" | "CLOSED";
  returned: number;
  total: number;
};

/** Confirm a (partial) return (§7.6): lines RETURNED, assets back or to review, loan closes when all are back. */
export async function returnAssets(actor: AccessUser, borrowingId: string, input: ReturnInput, ctx: Ctx, key: string) {
  const data = parse(returnSchema, input);
  const loan = await prisma.borrowing.findUnique({ where: { id: borrowingId }, select: { locationId: true } });
  if (!loan || !can(actor, "records.view", loan.locationId)) throw errors.notFound("loan");
  const receivingId = data.locationId ?? loan.locationId;
  requireAccess(actor, "custody.confirm", receivingId);
  const lineIds = data.lines.map((l) => l.lineId);
  if (new Set(lineIds).size !== lineIds.length)
    throw new ApiError("VALIDATION_FAILED", "The same asset is listed twice.");

  const result = await withIdempotency<ReturnResult>(
    { userId: actor.id, key, scope: "POST /api/v1/borrowings/return", payload: { borrowingId, ...data } },
    async (tx) => {
      const [b] = await tx.$queryRaw<{ status: string; reference: string }[]>`
        SELECT status::text AS status, reference FROM borrowings WHERE id = ${borrowingId}::uuid FOR UPDATE`;
      if (b.status !== "OPEN") throw new ApiError("CONFLICT", `Loan ${b.reference ?? ""} is not open.`);
      const receiving = await tx.location.findUnique({
        where: { id: receivingId },
        select: { id: true, code: true, isActive: true },
      });
      if (!receiving?.isActive) throw new ApiError("CONFLICT", "Pick an active receiving location.");
      const lines = await tx.borrowingLine.findMany({ where: { id: { in: lineIds }, borrowingId } });
      if (lines.length !== lineIds.length) throw errors.notFound("loan line");
      const assets = await lockAssets(
        tx,
        lines.map((l) => l.assetId),
      );
      const done = lines.filter((l) => l.status !== "OUT");
      if (done.length) {
        const tags = done.map((l) => assets.get(l.assetId)?.tag).join(", ");
        throw new ApiError("CONFLICT", `${tags} was already returned. Reload the loan.`);
      }

      const now = new Date();
      const reference = await nextReference(tx, "RET");
      const ret = await tx.assetReturn.create({
        data: {
          reference,
          borrowingId,
          locationId: receiving.id,
          returnedByName: data.returnedByName,
          receivedById: actor.id,
          notes: data.notes,
          returnedAt: now,
        },
      });
      for (const l of data.lines) {
        const line = lines.find((x) => x.id === l.lineId)!;
        const a = assets.get(line.assetId)!;
        const to: AssetStatus = l.condition === "DAMAGED" ? (l.damagedStatus ?? "NEEDS_REVIEW") : "AVAILABLE";
        const why = checkTransition(a.status, to, "return");
        if (why) throw new ApiError("CONFLICT", `${a.tag}: ${why}`);
        await tx.borrowingLine.update({
          where: { id: line.id },
          data: {
            status: "RETURNED",
            returnId: ret.id,
            conditionIn: l.condition,
            statusAfterReturn: to,
            missingAccessories: l.missingAccessories,
            returnNotes: l.notes,
            returnedAt: now,
          },
        });
        await tx.asset.update({
          where: { id: a.id },
          data: {
            status: to,
            custodianName: null,
            condition: l.condition,
            locationId: receiving.id,
            version: { increment: 1 },
          },
        });
        await tx.assetEvent.create({
          data: {
            assetId: a.id,
            eventType: "RETURNED",
            fromStatus: a.status,
            toStatus: to,
            fromCustodian: a.custodian_name,
            toCustodian: null,
            fromCondition: a.condition !== l.condition ? a.condition : undefined,
            toCondition: a.condition !== l.condition ? l.condition : undefined,
            fromLocationId: a.location_id !== receiving.id ? a.location_id : undefined,
            toLocationId: a.location_id !== receiving.id ? receiving.id : undefined,
            notes: [`Return ${reference}`, l.missingAccessories && `missing: ${l.missingAccessories}`, l.notes]
              .filter(Boolean)
              .join(" · "),
            actorId: actor.id,
            requestId: ctx.requestId,
          },
        });
      }
      const counts = await tx.borrowingLine.groupBy({ by: ["status"], where: { borrowingId }, _count: true });
      const total = counts.reduce((n, c) => n + c._count, 0);
      const returned = counts.find((c) => c.status === "RETURNED")?._count ?? 0;
      const closed = returned === total;
      if (closed)
        await tx.borrowing.update({
          where: { id: borrowingId },
          data: { status: "CLOSED", closedAt: now, version: { increment: 1 } },
        });
      await writeAudit(tx, {
        actorId: actor.id,
        eventType: "borrowing.returned",
        recordType: "borrowing",
        recordId: borrowingId,
        after: {
          loan: b.reference,
          return: reference,
          assets: data.lines.map((l) => assets.get(lines.find((x) => x.id === l.lineId)!.assetId)!.tag),
          closed,
        },
        requestId: ctx.requestId,
      });
      const documentId = await documentForReturn(tx, ret.id, reference, receiving.id, actor.id);
      return {
        status: 201,
        body: {
          returnId: ret.id,
          reference,
          documentId,
          loanStatus: closed ? ("CLOSED" as const) : ("OPEN" as const),
          returned,
          total,
        },
      };
    },
  );
  await renderIfPending(result.body.documentId);
  return result;
}

/** A supervisor turns down a request; it never becomes official (§13.3 REJECTED). */
export async function cancelBorrowDraft(actor: AccessUser, id: string, reason: string, ctx: Ctx) {
  const b = await prisma.borrowing.findUnique({ where: { id }, select: { locationId: true, status: true } });
  if (!b || !can(actor, "records.view", b.locationId)) throw errors.notFound("borrowing request");
  requireAccess(actor, "custody.confirm", b.locationId);
  if (b.status !== "DRAFT")
    throw new ApiError("CONFLICT", "Only requests that haven't been released can be cancelled.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.borrowing.update({ where: { id }, data: { status: "CANCELLED", version: { increment: 1 } } });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "borrowing.cancelled",
      recordType: "borrowing",
      recordId: id,
      after: { reason: reason.slice(0, 300) },
      requestId: ctx.requestId,
    });
    return r;
  });
}

export type LoanTab = "requests" | "active" | "overdue" | "closed";

export async function listBorrowings(actor: AccessUser, opts: { tab: LoanTab; page?: number; q?: string }) {
  const scope = requireAccess(actor, "records.view");
  const page = Math.max(1, opts.page ?? 1);
  const now = new Date();
  const status: Prisma.BorrowingWhereInput =
    opts.tab === "requests"
      ? { status: "DRAFT" }
      : opts.tab === "active"
        ? { status: "OPEN" }
        : opts.tab === "overdue"
          ? { status: "OPEN", dueAt: { lt: now } }
          : { status: { in: ["CLOSED", "CANCELLED"] } };
  const q = opts.q?.trim();
  const where: Prisma.BorrowingWhereInput = {
    ...status,
    ...(scope.scope === "global" ? {} : { locationId: { in: scope.locationIds } }),
    ...(actor.role === "FIELD" ? { preparedById: actor.id } : {}),
    ...(q
      ? {
          OR: [
            { reference: hasCode(q) },
            { borrowerName: has(q) },
            { lines: { some: { asset: { tag: hasCode(q) } } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.borrowing.findMany({
      where,
      orderBy:
        opts.tab === "closed"
          ? { updatedAt: "desc" }
          : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * 50,
      take: 50,
      select: {
        id: true,
        reference: true,
        status: true,
        borrowerName: true,
        borrowerDept: true,
        purpose: true,
        dueAt: true,
        releasedAt: true,
        createdAt: true,
        location: { select: { code: true } },
        preparedBy: { select: { name: true } },
        lines: { select: { status: true, asset: { select: { tag: true } } } },
      },
    }),
    prisma.borrowing.count({ where }),
  ]);
  return {
    rows: rows.map(({ lines, ...r }) => ({
      ...r,
      total: lines.length,
      returned: lines.filter((l) => l.status === "RETURNED").length,
      tags: lines.map((l) => l.asset.tag),
      overdue: r.status === "OPEN" && !!r.dueAt && r.dueAt < now,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / 50)),
  };
}

export async function getBorrowing(actor: AccessUser, id: string) {
  const b = await prisma.borrowing.findUnique({
    where: { id },
    include: {
      location: { select: { id: true, code: true, name: true } },
      preparedBy: { select: { name: true } },
      releasedBy: { select: { name: true } },
      lines: {
        orderBy: { asset: { tag: "asc" } },
        include: {
          asset: {
            select: {
              id: true,
              tag: true,
              serialNumber: true,
              status: true,
              item: { select: { name: true, sku: true } },
            },
          },
          return: { select: { reference: true } },
        },
      },
      returns: {
        orderBy: { returnedAt: "asc" },
        select: {
          id: true,
          reference: true,
          returnedAt: true,
          returnedByName: true,
          receivedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!b || !can(actor, "records.view", b.locationId)) throw errors.notFound("loan");
  if (actor.role === "FIELD" && b.preparedById !== actor.id) throw errors.notFound("loan");
  const documents = await prisma.pdfDocument.findMany({
    where: {
      OR: [
        { sourceType: "borrowing", sourceId: id },
        { sourceType: "asset_return", sourceId: { in: b.returns.map((r) => r.id) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, reference: true, type: true, status: true },
  });
  return { ...b, documents, overdue: b.status === "OPEN" && !!b.dueAt && b.dueAt < new Date() };
}
