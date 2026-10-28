import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { createItem, listItems, getItem } from "@/lib/inventory/items";
import { issueStock, receiveStock, transferStock } from "@/lib/inventory/stock";
import { companyYear } from "@/lib/inventory/sequences";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function code(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, "expected an ApiError").toBeInstanceOf(ApiError);
  return (e as ApiError).code;
}

async function world() {
  const whA = await makeLocation("WH-A");
  const whB = await makeLocation("WH-B");
  const siteC = await makeLocation("SITE-C", "SITE");
  const pair = await prisma.unit.create({ data: { code: "pair", name: "Pair" } });
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const ppe = await prisma.category.create({ data: { name: "PPE" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: whA.id }, { id: whB.id }])).id))!;
  const sup2 = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: whA.id }])).id))!;
  const field = (await loadAccessUser((await makeUser("FIELD", [{ id: whA.id }])).id))!;
  const gloves = await createItem(
    admin,
    {
      sku: "ppe-0001",
      name: "Safety Gloves",
      unitId: pair.id,
      categoryId: ppe.id,
      trackingType: "STOCK",
      minStock: 20,
    },
    ctx(),
  );
  const ties = await createItem(
    admin,
    { sku: "ELC-0001", name: "Cable ties", unitId: pcs.id, trackingType: "STOCK" },
    ctx(),
  );
  const drill = await createItem(
    admin,
    { sku: "TOOL-DRILL", name: "Cordless Drill", unitId: pcs.id, trackingType: "ASSET" },
    ctx(),
  );
  return { whA, whB, siteC, pair, pcs, ppe, admin, sup, sup2, field, gloves, ties, drill };
}

const bal = async (itemId: string, locationId: string) =>
  (await prisma.stockBalance.findUnique({ where: { itemId_locationId: { itemId, locationId } } }))?.quantity ?? 0;

/** Ledger invariant (§9.5): every balance equals the sum of its movements. */
async function ledgerMatchesBalances() {
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT bool_and(b.quantity = COALESCE(m.total, 0)) AS ok
    FROM stock_balances b
    LEFT JOIN (SELECT item_id, location_id, SUM(quantity)::int AS total FROM stock_movements GROUP BY 1, 2) m
      ON m.item_id = b.item_id AND m.location_id = b.location_id`;
  return rows[0].ok ?? true;
}

describe("A01: item master", () => {
  it("creates a searchable SKU (normalized) and rejects a duplicate", async () => {
    const w = await world();
    expect(w.gloves.sku).toBe("PPE-0001");
    const found = await listItems(w.sup, { q: "glov" });
    expect(found.rows.map((r) => r.sku)).toEqual(["PPE-0001"]);
    expect(
      await code(
        createItem(w.admin, { sku: " PPE-0001 ", name: "Again", unitId: w.pair.id, trackingType: "STOCK" }, ctx()),
      ),
    ).toBe("DUPLICATE");
  });

  it("lets a supervisor add items but not field staff", async () => {
    const w = await world();
    await createItem(w.sup, { sku: "NEW-1", name: "New", unitId: w.pcs.id, trackingType: "STOCK" }, ctx());
    expect(
      await code(createItem(w.field, { sku: "NEW-2", name: "No", unitId: w.pcs.id, trackingType: "STOCK" }, ctx())),
    ).toBe("FORBIDDEN");
  });
});

describe("A03: receive stock", () => {
  it("adds to the balance with one ledger line, a reference, and an audit event", async () => {
    const w = await world();
    const c = ctx();
    const r = await receiveStock(
      w.sup,
      {
        locationId: w.whA.id,
        source: "Supplier X",
        externalRef: "DR-778",
        lines: [{ itemId: w.gloves.id, quantity: 10 }],
      },
      c,
      randomUUID(),
    );
    expect(r.status).toBe(201);
    expect(r.body.reference).toMatch(/^RCV-\d{4}-000001$/);
    expect(r.body.lines).toEqual([
      expect.objectContaining({ itemId: w.gloves.id, quantity: 10, before: 0, after: 10 }),
    ]);
    expect(await bal(w.gloves.id, w.whA.id)).toBe(10);
    const moves = await prisma.stockMovement.findMany({ where: { itemId: w.gloves.id } });
    expect(moves.map((m) => [m.quantity, m.balanceAfter])).toEqual([[10, 10]]);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: "stock.received" } });
    expect(audit.recordId).toBe(r.body.id);
    expect(audit.requestId).toBe(c.requestId);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it("rejects zero/negative quantities, asset-tracked items, duplicate lines, and inactive locations", async () => {
    const w = await world();
    const go = (body: object) => receiveStock(w.sup, { locationId: w.whA.id, ...body } as never, ctx(), randomUUID());
    expect(await code(go({ lines: [{ itemId: w.gloves.id, quantity: 0 }] }))).toBe("VALIDATION_FAILED");
    expect(await code(go({ lines: [{ itemId: w.gloves.id, quantity: -3 }] }))).toBe("VALIDATION_FAILED");
    expect(await code(go({ lines: [{ itemId: w.gloves.id, quantity: 1.5 }] }))).toBe("VALIDATION_FAILED");
    expect(await code(go({ lines: [{ itemId: w.drill.id, quantity: 1 }] }))).toBe("VALIDATION_FAILED");
    expect(
      await code(
        go({
          lines: [
            { itemId: w.gloves.id, quantity: 1 },
            { itemId: w.gloves.id, quantity: 2 },
          ],
        }),
      ),
    ).toBe("VALIDATION_FAILED");
    await prisma.location.update({ where: { id: w.whA.id }, data: { isActive: false } });
    expect(await code(go({ lines: [{ itemId: w.gloves.id, quantity: 1 }] }))).toBe("CONFLICT");
    expect(await prisma.stockTransaction.count()).toBe(0);
  });

  it("numbers receipts in sequence", async () => {
    const w = await world();
    const a = await receiveStock(
      w.sup,
      { locationId: w.whA.id, lines: [{ itemId: w.ties.id, quantity: 1 }] },
      ctx(),
      randomUUID(),
    );
    const b = await receiveStock(
      w.sup,
      { locationId: w.whA.id, lines: [{ itemId: w.ties.id, quantity: 1 }] },
      ctx(),
      randomUUID(),
    );
    expect([a.body.reference.slice(-6), b.body.reference.slice(-6)]).toEqual(["000001", "000002"]);
  });
});

describe("issue stock", () => {
  it("subtracts, records recipient and purpose, and refuses more than is on hand", async () => {
    const w = await world();
    await receiveStock(
      w.sup,
      { locationId: w.whA.id, lines: [{ itemId: w.gloves.id, quantity: 120 }] },
      ctx(),
      randomUUID(),
    );
    const r = await issueStock(
      w.sup,
      {
        locationId: w.whA.id,
        recipientName: "Juan Dela Cruz",
        purpose: "Site repair",
        lines: [{ itemId: w.gloves.id, quantity: 5 }],
      },
      ctx(),
      randomUUID(),
    );
    expect(r.body.reference).toMatch(/^ISS-/);
    expect(r.body.lines[0]).toMatchObject({ before: 120, after: 115 });
    expect(await bal(w.gloves.id, w.whA.id)).toBe(115);

    const e = await issueStock(
      w.sup,
      { locationId: w.whA.id, recipientName: "X", purpose: "Y", lines: [{ itemId: w.gloves.id, quantity: 116 }] },
      ctx(),
      randomUUID(),
    ).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("INSUFFICIENT_STOCK");
    expect(e.status).toBe(409);
    expect(e.message).toMatch(/Only 115 .*Safety Gloves.*WH-A/);
    expect(await bal(w.gloves.id, w.whA.id)).toBe(115);
  });

  it("A22: a field user cannot issue stock and the balance stays the same", async () => {
    const w = await world();
    await receiveStock(
      w.sup,
      { locationId: w.whA.id, lines: [{ itemId: w.gloves.id, quantity: 10 }] },
      ctx(),
      randomUUID(),
    );
    expect(
      await code(
        issueStock(
          w.field,
          { locationId: w.whA.id, recipientName: "Me", purpose: "x", lines: [{ itemId: w.gloves.id, quantity: 1 }] },
          ctx(),
          randomUUID(),
        ),
      ),
    ).toBe("FORBIDDEN");
    expect(await bal(w.gloves.id, w.whA.id)).toBe(10);
  });

  it("refuses to issue at a location the supervisor isn't assigned to", async () => {
    const w = await world();
    expect(
      await code(
        issueStock(
          w.sup,
          { locationId: w.siteC.id, recipientName: "A", purpose: "B", lines: [{ itemId: w.gloves.id, quantity: 1 }] },
          ctx(),
          randomUUID(),
        ),
      ),
    ).toBe("FORBIDDEN");
  });

  it("A04: two people issuing the last 3 units at the same time: exactly one succeeds", async () => {
    const w = await world();
    await receiveStock(
      w.sup,
      { locationId: w.whA.id, lines: [{ itemId: w.gloves.id, quantity: 3 }] },
      ctx(),
      randomUUID(),
    );
    const attempt = (who: typeof w.sup) =>
      issueStock(
        who,
        { locationId: w.whA.id, recipientName: "R", purpose: "P", lines: [{ itemId: w.gloves.id, quantity: 3 }] },
        ctx(),
        randomUUID(),
      ).then(
        () => "ok",
        (e) => (e as ApiError).code,
      );
    // Force a real overlap: hold the ISS numbering row so both requests are
    // inside their transactions (past the balance check) at the same time.
    await prisma.documentSequence.create({ data: { docType: "ISS", year: companyYear(), next: 1 } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM document_sequences WHERE doc_type = 'ISS' FOR UPDATE`;
      locked();
      await gate;
    });
    await isLocked;
    const racing = Promise.all([attempt(w.sup), attempt(w.sup2)]);
    await new Promise((r) => setTimeout(r, 500)); // both are now waiting inside their transactions
    release();
    await holder;
    const results = await racing;
    expect(results.sort()).toEqual(["INSUFFICIENT_STOCK", "ok"]);
    expect(await bal(w.gloves.id, w.whA.id)).toBe(0);
    expect(await prisma.stockTransaction.count({ where: { type: "ISSUE" } })).toBe(1);
    expect(await ledgerMatchesBalances()).toBe(true);
  });
});

describe("transfer stock", () => {
  it("A05: moves 7 from A to B under one reference; the two lines sum to zero", async () => {
    const w = await world();
    await receiveStock(
      w.sup,
      { locationId: w.whA.id, lines: [{ itemId: w.ties.id, quantity: 40 }] },
      ctx(),
      randomUUID(),
    );
    const r = await transferStock(
      w.sup,
      {
        fromLocationId: w.whA.id,
        toLocationId: w.whB.id,
        reason: "Rebalance",
        lines: [{ itemId: w.ties.id, quantity: 7 }],
      },
      ctx(),
      randomUUID(),
    );
    expect(r.body.reference).toMatch(/^TRN-/);
    expect(await bal(w.ties.id, w.whA.id)).toBe(33);
    expect(await bal(w.ties.id, w.whB.id)).toBe(7);
    const moves = await prisma.stockMovement.findMany({
      where: { transactionId: r.body.id },
      orderBy: { quantity: "asc" },
    });
    expect(moves.map((m) => m.quantity)).toEqual([-7, 7]);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it("A06: if any part of a transfer fails, neither balance changes", async () => {
    const w = await world();
    await receiveStock(
      w.sup,
      {
        locationId: w.whA.id,
        lines: [
          { itemId: w.ties.id, quantity: 40 },
          { itemId: w.gloves.id, quantity: 2 },
        ],
      },
      ctx(),
      randomUUID(),
    );
    const err = await code(
      transferStock(
        w.sup,
        {
          fromLocationId: w.whA.id,
          toLocationId: w.whB.id,
          lines: [
            { itemId: w.ties.id, quantity: 7 },
            { itemId: w.gloves.id, quantity: 5 },
          ],
        },
        ctx(),
        randomUUID(),
      ),
    );
    expect(err).toBe("INSUFFICIENT_STOCK");
    expect([await bal(w.ties.id, w.whA.id), await bal(w.ties.id, w.whB.id), await bal(w.gloves.id, w.whA.id)]).toEqual([
      40, 0, 2,
    ]);
    expect(await prisma.stockTransaction.count({ where: { type: "TRANSFER" } })).toBe(0);
  });

  it("rejects a transfer to the same location and needs access at both ends", async () => {
    const w = await world();
    expect(
      await code(
        transferStock(
          w.sup,
          { fromLocationId: w.whA.id, toLocationId: w.whA.id, lines: [{ itemId: w.ties.id, quantity: 1 }] },
          ctx(),
          randomUUID(),
        ),
      ),
    ).toBe("VALIDATION_FAILED");
    expect(
      await code(
        transferStock(
          w.sup,
          { fromLocationId: w.whA.id, toLocationId: w.siteC.id, lines: [{ itemId: w.ties.id, quantity: 1 }] },
          ctx(),
          randomUUID(),
        ),
      ),
    ).toBe("FORBIDDEN");
  });
});

describe("idempotency (§12.4)", () => {
  it("repeating a confirm with the same key changes stock once; a changed body is rejected", async () => {
    const w = await world();
    const key = randomUUID();
    const body = { locationId: w.whA.id, lines: [{ itemId: w.gloves.id, quantity: 4 }] };
    const a = await receiveStock(w.sup, body, ctx(), key);
    const b = await receiveStock(w.sup, body, ctx(), key);
    expect(b.replayed).toBe(true);
    expect(b.body.reference).toBe(a.body.reference);
    expect(await bal(w.gloves.id, w.whA.id)).toBe(4);
    expect(
      await code(receiveStock(w.sup, { ...body, lines: [{ itemId: w.gloves.id, quantity: 5 }] }, ctx(), key)),
    ).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("item detail and list scope", () => {
  it("shows balances only for locations the user can see, with status Low/Out", async () => {
    const w = await world();
    await receiveStock(
      w.admin,
      { locationId: w.siteC.id, lines: [{ itemId: w.gloves.id, quantity: 50 }] },
      ctx(),
      randomUUID(),
    );
    await receiveStock(
      w.admin,
      { locationId: w.whA.id, lines: [{ itemId: w.gloves.id, quantity: 12 }] },
      ctx(),
      randomUUID(),
    );
    const d = await getItem(w.sup2, w.gloves.id);
    expect(d.balances.map((b) => [b.location.code, b.quantity])).toEqual([["WH-A", 12]]);
    expect(d.movements.every((m) => m.location.code === "WH-A")).toBe(true);
    const list = await listItems(w.sup2, { stock: "low" });
    expect(list.rows.map((r) => [r.sku, r.onHand, r.stockStatus])).toEqual([["PPE-0001", 12, "LOW"]]);
    const out = await listItems(w.sup2, { stock: "out", tracking: "STOCK" });
    expect(out.rows.map((r) => r.sku)).toEqual(["ELC-0001"]);
  });
});
