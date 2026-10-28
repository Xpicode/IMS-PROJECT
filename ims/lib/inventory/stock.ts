import "server-only";
import { ApiError, errors } from "@/lib/api/errors";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { withIdempotency } from "@/lib/idempotency";
import type { Ctx } from "@/lib/context";
import type { Prisma } from "@/generated/prisma/client";
import {
  issueSchema,
  parse,
  receiptSchema,
  transferSchema,
  type IssueInput,
  type ReceiptInput,
  type TransferInput,
} from "@/lib/validation";
import { nextReference } from "./sequences";

/**
 * Official stock movements (spec §7.2–7.4, §9.3). Every confirm:
 * - checks permission at each location involved,
 * - runs in ONE database transaction with row locks,
 * - writes a transaction header, signed ledger lines, new balances, and an audit event,
 * - is idempotent per Idempotency-Key (§12.4).
 * Balances never go negative (also enforced by a CHECK constraint).
 */
export type StockLineResult = {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  locationId: string;
  quantity: number;
  before: number;
  after: number;
};
export type StockResult = {
  id: string;
  reference: string;
  type: "RECEIPT" | "ISSUE" | "TRANSFER";
  status: "CONFIRMED";
  confirmedAt: string;
  lines: StockLineResult[];
};

type Tx = Prisma.TransactionClient;
type Loc = { id: string; code: string; name: string };
type ItemInfo = { id: string; sku: string; name: string; unit: string };

async function activeLocation(tx: Tx, id: string): Promise<Loc> {
  const l = await tx.location.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, isActive: true },
  });
  if (!l) throw errors.notFound("location");
  if (!l.isActive) throw new ApiError("CONFLICT", `${l.code} is inactive. Reactivate it or pick another location.`);
  return l;
}

async function stockItems(tx: Tx, ids: string[]): Promise<Map<string, ItemInfo>> {
  const items = await tx.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, name: true, trackingType: true, isActive: true, unit: { select: { code: true } } },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of ids) {
    const i = byId.get(id);
    if (!i) throw errors.notFound("item");
    if (!i.isActive) throw new ApiError("CONFLICT", `${i.sku} is inactive. Reactivate it before moving stock.`);
    if (i.trackingType !== "STOCK") {
      throw new ApiError(
        "VALIDATION_FAILED",
        `${i.sku} is tracked as individual assets, not counted stock. Use Assets instead.`,
        {
          fields: { lines: [`${i.sku} is an asset item.`] },
        },
      );
    }
  }
  return new Map(items.map((i) => [i.id, { id: i.id, sku: i.sku, name: i.name, unit: i.unit.code }]));
}

/** Make sure balance rows exist, then lock them in a stable order (item, location) to avoid deadlocks. */
async function lockBalances(tx: Tx, pairs: { itemId: string; locationId: string }[]) {
  const itemIds = pairs.map((p) => p.itemId);
  const locIds = pairs.map((p) => p.locationId);
  await tx.$executeRaw`
    INSERT INTO stock_balances (item_id, location_id, quantity, version, updated_at)
    SELECT i, l, 0, 1, now() FROM unnest(${itemIds}::uuid[], ${locIds}::uuid[]) AS t(i, l)
    ON CONFLICT DO NOTHING`;
  const rows = await tx.$queryRaw<{ item_id: string; location_id: string; quantity: number }[]>`
    SELECT b.item_id, b.location_id, b.quantity FROM stock_balances b
    JOIN unnest(${itemIds}::uuid[], ${locIds}::uuid[]) AS t(i, l) ON b.item_id = t.i AND b.location_id = t.l
    ORDER BY b.item_id, b.location_id
    FOR UPDATE OF b`;
  return new Map(rows.map((r) => [`${r.item_id}|${r.location_id}`, Number(r.quantity)]));
}

async function post(
  tx: Tx,
  txnId: string,
  balances: Map<string, number>,
  itemId: string,
  locationId: string,
  delta: number,
) {
  const key = `${itemId}|${locationId}`;
  const before = balances.get(key) ?? 0;
  const after = before + delta;
  await tx.stockBalance.update({
    where: { itemId_locationId: { itemId, locationId } },
    data: { quantity: after, version: { increment: 1 } },
  });
  await tx.stockMovement.create({
    data: { transactionId: txnId, itemId, locationId, quantity: delta, balanceAfter: after },
  });
  balances.set(key, after);
  return { before, after };
}

function insufficient(item: ItemInfo, loc: Loc, have: number, want: number) {
  return new ApiError(
    "INSUFFICIENT_STOCK",
    `Only ${have} ${item.unit} of ${item.name} left at ${loc.code} (you asked for ${want}). Lower the quantity or pick another location.`,
  );
}

const done = (
  txn: { id: string; reference: string; type: string; confirmedAt: Date },
  lines: StockLineResult[],
): { status: number; body: StockResult } => ({
  status: 201,
  body: {
    id: txn.id,
    reference: txn.reference,
    type: txn.type as StockResult["type"],
    status: "CONFIRMED",
    confirmedAt: txn.confirmedAt.toISOString(),
    lines,
  },
});

export async function receiveStock(actor: AccessUser, input: ReceiptInput, ctx: Ctx, key: string) {
  const data = parse(receiptSchema, input);
  requireAccess(actor, "stock.move", data.locationId);
  return withIdempotency({ userId: actor.id, key, scope: "POST /api/v1/stock/receipts", payload: data }, async (tx) => {
    const loc = await activeLocation(tx, data.locationId);
    const items = await stockItems(
      tx,
      data.lines.map((l) => l.itemId),
    );
    const balances = await lockBalances(
      tx,
      data.lines.map((l) => ({ itemId: l.itemId, locationId: loc.id })),
    );
    const txn = await tx.stockTransaction.create({
      data: {
        reference: await nextReference(tx, "RCV"),
        type: "RECEIPT",
        source: data.source,
        externalRef: data.externalRef,
        notes: data.notes,
        actorId: actor.id,
        requestId: ctx.requestId,
      },
    });
    const lines: StockLineResult[] = [];
    for (const l of [...data.lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
      const it = items.get(l.itemId)!;
      const r = await post(tx, txn.id, balances, l.itemId, loc.id, l.quantity);
      lines.push({
        itemId: it.id,
        sku: it.sku,
        name: it.name,
        unit: it.unit,
        locationId: loc.id,
        quantity: l.quantity,
        ...r,
      });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "stock.received",
      recordType: "stock_transaction",
      recordId: txn.id,
      after: {
        reference: txn.reference,
        location: loc.code,
        source: data.source,
        lines: lines.map((x) => ({ sku: x.sku, qty: x.quantity })),
      },
      requestId: ctx.requestId,
    });
    return done(txn, lines);
  });
}

export async function issueStock(actor: AccessUser, input: IssueInput, ctx: Ctx, key: string) {
  const data = parse(issueSchema, input);
  requireAccess(actor, "stock.move", data.locationId);
  return withIdempotency({ userId: actor.id, key, scope: "POST /api/v1/stock/issues", payload: data }, async (tx) => {
    const loc = await activeLocation(tx, data.locationId);
    const items = await stockItems(
      tx,
      data.lines.map((l) => l.itemId),
    );
    const balances = await lockBalances(
      tx,
      data.lines.map((l) => ({ itemId: l.itemId, locationId: loc.id })),
    );
    // Check every line against the locked balances before writing anything.
    for (const l of data.lines) {
      const have = balances.get(`${l.itemId}|${loc.id}`) ?? 0;
      if (have < l.quantity) throw insufficient(items.get(l.itemId)!, loc, have, l.quantity);
    }
    const txn = await tx.stockTransaction.create({
      data: {
        reference: await nextReference(tx, "ISS"),
        type: "ISSUE",
        recipientName: data.recipientName,
        reason: data.purpose,
        notes: data.notes,
        actorId: actor.id,
        requestId: ctx.requestId,
      },
    });
    const lines: StockLineResult[] = [];
    for (const l of [...data.lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
      const it = items.get(l.itemId)!;
      const r = await post(tx, txn.id, balances, l.itemId, loc.id, -l.quantity);
      lines.push({
        itemId: it.id,
        sku: it.sku,
        name: it.name,
        unit: it.unit,
        locationId: loc.id,
        quantity: l.quantity,
        ...r,
      });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "stock.issued",
      recordType: "stock_transaction",
      recordId: txn.id,
      after: {
        reference: txn.reference,
        location: loc.code,
        recipient: data.recipientName,
        purpose: data.purpose,
        lines: lines.map((x) => ({ sku: x.sku, qty: x.quantity })),
      },
      requestId: ctx.requestId,
    });
    return done(txn, lines);
  });
}

export async function transferStock(actor: AccessUser, input: TransferInput, ctx: Ctx, key: string) {
  const data = parse(transferSchema, input);
  requireAccess(actor, "stock.move", data.fromLocationId);
  requireAccess(actor, "stock.move", data.toLocationId);
  return withIdempotency(
    { userId: actor.id, key, scope: "POST /api/v1/stock/transfers", payload: data },
    async (tx) => {
      const from = await activeLocation(tx, data.fromLocationId);
      const to = await activeLocation(tx, data.toLocationId);
      const items = await stockItems(
        tx,
        data.lines.map((l) => l.itemId),
      );
      const balances = await lockBalances(
        tx,
        data.lines.flatMap((l) => [
          { itemId: l.itemId, locationId: from.id },
          { itemId: l.itemId, locationId: to.id },
        ]),
      );
      for (const l of data.lines) {
        const have = balances.get(`${l.itemId}|${from.id}`) ?? 0;
        if (have < l.quantity) throw insufficient(items.get(l.itemId)!, from, have, l.quantity);
      }
      const txn = await tx.stockTransaction.create({
        data: {
          reference: await nextReference(tx, "TRN"),
          type: "TRANSFER",
          reason: data.reason,
          notes: data.notes,
          actorId: actor.id,
          requestId: ctx.requestId,
        },
      });
      const lines: StockLineResult[] = [];
      for (const l of [...data.lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
        const it = items.get(l.itemId)!;
        const out = await post(tx, txn.id, balances, l.itemId, from.id, -l.quantity);
        const inn = await post(tx, txn.id, balances, l.itemId, to.id, l.quantity);
        lines.push({
          itemId: it.id,
          sku: it.sku,
          name: it.name,
          unit: it.unit,
          locationId: from.id,
          quantity: l.quantity,
          ...out,
        });
        lines.push({
          itemId: it.id,
          sku: it.sku,
          name: it.name,
          unit: it.unit,
          locationId: to.id,
          quantity: l.quantity,
          ...inn,
        });
      }
      await writeAudit(tx, {
        actorId: actor.id,
        eventType: "stock.transferred",
        recordType: "stock_transaction",
        recordId: txn.id,
        after: {
          reference: txn.reference,
          from: from.code,
          to: to.code,
          lines: data.lines.map((x) => ({ sku: items.get(x.itemId)!.sku, qty: x.quantity })),
        },
        requestId: ctx.requestId,
      });
      return done(txn, lines);
    },
  );
}

/** Current balances at one location for the wizards' before → after preview. */
export async function getBalances(actor: AccessUser, locationId: string, itemIds: string[], tx?: Tx) {
  requireAccess(actor, "records.view", locationId);
  const { prisma } = await import("@/lib/db/prisma");
  const rows = await (tx ?? prisma).stockBalance.findMany({
    where: { locationId, itemId: { in: itemIds.slice(0, 200) } },
    select: { itemId: true, quantity: true },
  });
  return Object.fromEntries(itemIds.map((id) => [id, rows.find((r) => r.itemId === id)?.quantity ?? 0]));
}
