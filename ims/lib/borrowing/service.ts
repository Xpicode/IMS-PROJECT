import "server-only";
import { has, hasCode } from "@/lib/db/search";
import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { withIdempotency } from "@/lib/idempotency";
import { nextReference } from "@/lib/inventory/sequences";
import { activeLocation, checkCountFreeze, insufficient, lockBalances, post, stockItems } from "@/lib/inventory/stock";
import { documentForBorrowing, documentForReturn, renderIfPending } from "@/lib/documents/service";
import type { Ctx } from "@/lib/context";
import { checkEvidence } from "@/lib/evidence";
import { codeVariants, normalizeCode } from "@/lib/codes";
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
 * Borrowing and returns (spec §7.5–7.6), taken straight from stock:
 * - release deducts each quantity from the location's stock (a BOR- stock move),
 * - a return puts what came back into stock (a RET- stock move), and the loan
 *   stays open until everything is back or a supervisor closes it as not returned.
 * Each runs in ONE transaction with the balance rows locked, so stock can't go
 * below zero even when two releases race (the database also refuses it).
 */
/** A field user (or anyone) prepares a loan: no number, stock doesn't change until a supervisor releases it. */
export async function createBorrowDraft(
  actor: AccessUser,
  input: BorrowDraftInput,
  ctx: Ctx,
  key: string = randomUUID(),
) {
  const data = parse(borrowDraftSchema, input);
  requireAccess(actor, "drafts.prepare", data.locationId);
  // Codes typed or scanned offline: the SKU, or a barcode on the item.
  const unknown: string[] = [];
  const lines = new Map<string, number>();
  for (const l of data.lines) {
    let id = l.itemId;
    if (!id) {
      const c = normalizeCode(l.code!);
      id =
        (await prisma.item.findUnique({ where: { sku: c }, select: { id: true } }))?.id ??
        (
          await prisma.itemIdentifier.findFirst({
            where: { code: { in: codeVariants(c) }, isActive: true, itemId: { not: null } },
            select: { itemId: true },
          })
        )?.itemId ??
        undefined;
      if (!id) {
        unknown.push(c);
        continue;
      }
    }
    // The same item twice (typed once, scanned once): one line with both quantities.
    lines.set(id, (lines.get(id) ?? 0) + l.quantity);
  }
  if (unknown.length)
    throw new ApiError("VALIDATION_FAILED", `No item has the code ${unknown.join(", ")}. Check the label.`, {
      fields: { lines: [`Unknown code: ${unknown.join(", ")}`] },
    });
  const found = await prisma.item.count({ where: { id: { in: [...lines.keys()] }, isActive: true } });
  if (found !== lines.size) throw errors.notFound("item");
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
          lines: { create: [...lines].map(([itemId, quantity]) => ({ itemId, quantity })) },
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        eventType: "borrowing.drafted",
        recordType: "borrowing",
        recordId: b.id,
        after: { borrower: b.borrowerName, items: lines.size },
        requestId: ctx.requestId,
      });
      return { status: 201, body: { id: b.id } };
    },
  );
  return r.body;
}

export type ReleaseResult = {
  id: string;
  reference: string;
  documentId: string;
  lines: { sku: string; quantity: number; unit: string }[];
};

/** Confirm a release (§7.5 steps 3–5): loan OPEN with a BOR- number, quantities out of stock, audit, form. */
export async function releaseBorrowing(actor: AccessUser, input: ReleaseInput, ctx: Ctx, key: string) {
  const data = parse(releaseSchema, input);
  requireAccess(actor, "custody.confirm", data.locationId);

  const result = await withIdempotency<ReleaseResult>(
    { userId: actor.id, key, scope: "POST /api/v1/borrowings/release", payload: data },
    async (tx) => {
      const loc = await activeLocation(tx, data.locationId);
      let draftId: string | null = null;
      if (data.draftId) {
        const [d] = await tx.$queryRaw<{ id: string; status: string; location_id: string }[]>`
          SELECT id, status::text AS status, location_id FROM borrowings WHERE id = ${data.draftId}::uuid FOR UPDATE`;
        if (!d || d.location_id !== loc.id) throw errors.notFound("borrowing request");
        if (d.status !== "DRAFT") throw new ApiError("CONFLICT", "This request was already released or cancelled.");
        draftId = d.id;
      }

      const items = await stockItems(
        tx,
        data.lines.map((l) => l.itemId),
      );
      const pairs = data.lines.map((l) => ({ itemId: l.itemId, locationId: loc.id }));
      await checkCountFreeze(tx, actor, pairs, undefined);
      const balances = await lockBalances(tx, pairs);
      for (const l of data.lines) {
        const have = balances.get(`${l.itemId}|${loc.id}`) ?? 0;
        if (have < l.quantity) throw insufficient(items.get(l.itemId)!, loc, have, l.quantity);
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
        preparedByName: data.preparedByName ?? null,
        notes: data.notes ?? null,
        releasedById: actor.id,
        releasedAt: now,
      };
      let loanId: string;
      if (draftId) {
        // The supervisor's final list replaces whatever the request had.
        await tx.borrowingLine.deleteMany({ where: { borrowingId: draftId } });
        await tx.borrowing.update({ where: { id: draftId }, data: { ...header, version: { increment: 1 } } });
        loanId = draftId;
      } else {
        loanId = (await tx.borrowing.create({ data: { ...header, locationId: loc.id, preparedById: actor.id } })).id;
      }
      await tx.borrowingLine.createMany({
        data: data.lines.map((l) => ({
          borrowingId: loanId,
          itemId: l.itemId,
          quantity: l.quantity,
          status: "OUT" as const,
          conditionOut: l.condition,
          accessories: l.accessories,
        })),
      });

      // The stock side: one BORROW move with the loan's own number.
      const txn = await tx.stockTransaction.create({
        data: {
          reference,
          type: "BORROW",
          reason: data.purpose,
          recipientName: data.borrowerName,
          notes: data.notes,
          actorId: actor.id,
          requestId: ctx.requestId,
          confirmedAt: now,
        },
      });
      for (const l of data.lines) await post(tx, txn.id, balances, l.itemId, loc.id, -l.quantity);

      const lines = data.lines.map((l) => {
        const i = items.get(l.itemId)!;
        return { sku: i.sku, quantity: l.quantity, unit: i.unit };
      });
      await writeAudit(tx, {
        actorId: actor.id,
        eventType: "borrowing.released",
        recordType: "borrowing",
        recordId: loanId,
        after: { reference, borrower: data.borrowerName, location: loc.code, lines },
        requestId: ctx.requestId,
      });
      const documentId = await documentForBorrowing(tx, loanId, reference, loc.id, actor.id);
      return { status: 201, body: { id: loanId, reference, documentId, lines } };
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
  /** Units back so far and units borrowed, over the whole loan. */
  returned: number;
  total: number;
};

/** Confirm a (partial) return (§7.6): what came back goes into stock; the loan closes when everything is back. */
export async function returnItems(actor: AccessUser, borrowingId: string, input: ReturnInput, ctx: Ctx, key: string) {
  const data = parse(returnSchema, input);
  const loan = await prisma.borrowing.findUnique({ where: { id: borrowingId }, select: { locationId: true } });
  if (!loan || !can(actor, "records.view", loan.locationId)) throw errors.notFound("loan");
  const receivingId = data.locationId ?? loan.locationId;
  requireAccess(actor, "custody.confirm", receivingId);

  const result = await withIdempotency<ReturnResult>(
    { userId: actor.id, key, scope: "POST /api/v1/borrowings/return", payload: { borrowingId, ...data } },
    async (tx) => {
      const [b] = await tx.$queryRaw<{ status: string; reference: string }[]>`
        SELECT status::text AS status, reference FROM borrowings WHERE id = ${borrowingId}::uuid FOR UPDATE`;
      if (b.status !== "OPEN") throw new ApiError("CONFLICT", `Loan ${b.reference ?? ""} is not open.`);
      const receiving = await activeLocation(tx, receivingId);
      const lineIds = data.lines.map((l) => l.lineId);
      const lines = await tx.borrowingLine.findMany({
        where: { id: { in: lineIds }, borrowingId },
        include: { item: { select: { sku: true, name: true, unit: { select: { code: true } } } } },
      });
      if (lines.length !== lineIds.length) throw errors.notFound("loan line");
      for (const l of data.lines) {
        const line = lines.find((x) => x.id === l.lineId)!;
        const out = line.quantity - line.returnedQuantity;
        if (line.status !== "OUT" || out <= 0)
          throw new ApiError("CONFLICT", `${line.item.sku} is already all back. Reload the loan.`);
        if (l.quantity > out)
          throw new ApiError(
            "VALIDATION_FAILED",
            `Only ${out} ${line.item.unit.code} of ${line.item.name} is still out (you entered ${l.quantity}).`,
            { fields: { lines: [`${line.item.sku}: at most ${out}.`] } },
          );
      }

      const pairs = lines.map((l) => ({ itemId: l.itemId, locationId: receiving.id }));
      await checkCountFreeze(tx, actor, pairs, undefined);
      const balances = await lockBalances(tx, pairs);
      const now = new Date();
      const reference = await nextReference(tx, "RET");
      const ret = await tx.borrowingReturn.create({
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
      const txn = await tx.stockTransaction.create({
        data: {
          reference,
          type: "RETURN",
          source: `${b.reference} · ${data.returnedByName}`,
          notes: data.notes,
          actorId: actor.id,
          requestId: ctx.requestId,
          confirmedAt: now,
        },
      });
      for (const l of data.lines) {
        const line = lines.find((x) => x.id === l.lineId)!;
        await checkEvidence(
          tx,
          actor.id,
          { kind: "RETURN", targetId: line.id, locationId: receiving.id },
          l.evidenceIds ?? [],
        );
        await tx.returnLine.create({
          data: { returnId: ret.id, lineId: line.id, quantity: l.quantity, condition: l.condition, notes: l.notes },
        });
        const back = line.returnedQuantity + l.quantity;
        await tx.borrowingLine.update({
          where: { id: line.id },
          data: {
            returnedQuantity: back,
            status: back === line.quantity ? "RETURNED" : "OUT",
            photos: { create: (l.evidenceIds ?? []).map((photoId) => ({ photoId })) },
          },
        });
        await post(tx, txn.id, balances, line.itemId, receiving.id, l.quantity);
      }

      const all = await tx.borrowingLine.findMany({
        where: { borrowingId },
        select: { quantity: true, returnedQuantity: true },
      });
      const total = all.reduce((n, l) => n + l.quantity, 0);
      const returned = all.reduce((n, l) => n + l.returnedQuantity, 0);
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
          location: receiving.code,
          lines: data.lines.map((l) => ({
            sku: lines.find((x) => x.id === l.lineId)!.item.sku,
            quantity: l.quantity,
            condition: l.condition,
          })),
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

/**
 * A supervisor closes an open loan whose rest won't come back (lost, used up, broken beyond use).
 * What is still out stays deducted from stock; the reason is kept in the audit log.
 */
export async function closeBorrowing(actor: AccessUser, id: string, reason: string, ctx: Ctx) {
  const why = reason?.trim() ?? "";
  if (why.length < 3)
    throw new ApiError("VALIDATION_FAILED", "Say why the rest won't come back.", {
      fields: { reason: ["Say why the rest won't come back."] },
    });
  const b = await prisma.borrowing.findUnique({ where: { id }, select: { locationId: true } });
  if (!b || !can(actor, "records.view", b.locationId)) throw errors.notFound("loan");
  requireAccess(actor, "custody.confirm", b.locationId);
  return prisma.$transaction(async (tx) => {
    const [l] = await tx.$queryRaw<{ status: string; reference: string }[]>`
      SELECT status::text AS status, reference FROM borrowings WHERE id = ${id}::uuid FOR UPDATE`;
    if (l.status !== "OPEN") throw new ApiError("CONFLICT", `Loan ${l.reference ?? ""} is not open.`);
    const out = await tx.borrowingLine.findMany({
      where: { borrowingId: id, status: "OUT" },
      select: { quantity: true, returnedQuantity: true, item: { select: { sku: true } } },
    });
    const r = await tx.borrowing.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date(), version: { increment: 1 } },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "borrowing.closed_not_returned",
      recordType: "borrowing",
      recordId: id,
      after: {
        loan: l.reference,
        reason: why.slice(0, 300),
        notReturned: out.map((o) => ({ sku: o.item.sku, quantity: o.quantity - o.returnedQuantity })),
      },
      requestId: ctx.requestId,
    });
    return r;
  });
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

export async function listBorrowings(
  actor: AccessUser,
  opts: { tab: LoanTab; page?: number; pageSize?: number; q?: string },
) {
  const scope = requireAccess(actor, "records.view");
  const page = Math.max(1, opts.page ?? 1);
  const size = Math.min(1000, Math.max(1, opts.pageSize ?? 50));
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
            { lines: { some: { item: { OR: [{ sku: hasCode(q) }, { name: has(q) }] } } } },
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
      skip: (page - 1) * size,
      take: size,
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
        lines: {
          select: { quantity: true, returnedQuantity: true, item: { select: { name: true } } },
          orderBy: { item: { name: "asc" } },
        },
      },
    }),
    prisma.borrowing.count({ where }),
  ]);
  return {
    rows: rows.map(({ lines, ...r }) => ({
      ...r,
      total: lines.reduce((n, l) => n + l.quantity, 0),
      returned: lines.reduce((n, l) => n + l.returnedQuantity, 0),
      /** "3 × Drill", one per line, for the list. */
      items: lines.map((l) => `${l.quantity} × ${l.item.name}`),
      overdue: r.status === "OPEN" && !!r.dueAt && r.dueAt < now,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / size)),
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
        orderBy: { item: { name: "asc" } },
        include: {
          item: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } },
          returnLines: {
            orderBy: { return: { returnedAt: "asc" } },
            select: {
              quantity: true,
              condition: true,
              notes: true,
              return: { select: { reference: true, returnedAt: true } },
            },
          },
          photos: { select: { photoId: true } },
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
        { sourceType: "borrowing_return", sourceId: { in: b.returns.map((r) => r.id) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, reference: true, type: true, status: true },
  });
  return { ...b, documents, overdue: b.status === "OPEN" && !!b.dueAt && b.dueAt < new Date() };
}
