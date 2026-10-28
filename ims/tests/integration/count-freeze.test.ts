import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { issueStock, receiveStock, transferStock } from "@/lib/inventory/stock";
import { closeCountSession, createCountSession } from "@/lib/counts/service";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function world() {
  const wh = await makeLocation("WH-A");
  const ws = await makeLocation("WORKSHOP");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }, { id: ws.id }])).id))!;
  const gloves = await createItem(
    admin,
    { sku: "PPE-1", name: "Gloves", unitId: pcs.id, trackingType: "STOCK" },
    ctx(),
  );
  const ties = await createItem(admin, { sku: "ELC-1", name: "Ties", unitId: pcs.id, trackingType: "STOCK" }, ctx());
  await receiveStock(admin, { locationId: wh.id, lines: [{ itemId: gloves.id, quantity: 50 }] }, ctx(), randomUUID());
  await receiveStock(admin, { locationId: ws.id, lines: [{ itemId: ties.id, quantity: 20 }] }, ctx(), randomUUID());
  const count = await createCountSession(
    sup,
    { name: "Q4", locationId: wh.id, assigneeIds: [], includeStock: true, includeAssets: false },
    ctx(),
  );
  const balance = async (itemId: string, locationId: string) =>
    (await prisma.stockBalance.findUnique({ where: { itemId_locationId: { itemId, locationId } } }))?.quantity ?? 0;
  return { wh, ws, admin, sup, gloves, ties, count, balance };
}

const err = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, "expected an ApiError").toBeInstanceOf(ApiError);
  return e as ApiError;
};

describe("count freeze (§7.7)", () => {
  it("blocks issuing a counted item at the location while its count is open", async () => {
    const w = await world();
    const e = await err(
      issueStock(
        w.sup,
        { locationId: w.wh.id, lines: [{ itemId: w.gloves.id, quantity: 5 }], recipientName: "Juan", purpose: "Job" },
        ctx(),
        randomUUID(),
      ),
    );
    expect(e.code).toBe("COUNT_IN_PROGRESS");
    expect(e.message).toMatch(/PPE-1/);
    expect(e.message).toMatch(new RegExp(w.count.reference));
    expect(await w.balance(w.gloves.id, w.wh.id)).toBe(50);
  });

  it("also blocks receiving and either end of a transfer", async () => {
    const w = await world();
    const rcv = await err(
      receiveStock(w.sup, { locationId: w.wh.id, lines: [{ itemId: w.gloves.id, quantity: 1 }] }, ctx(), randomUUID()),
    );
    expect(rcv.code).toBe("COUNT_IN_PROGRESS");
    const out = await err(
      transferStock(
        w.sup,
        {
          fromLocationId: w.wh.id,
          toLocationId: w.ws.id,
          lines: [{ itemId: w.gloves.id, quantity: 1 }],
          reason: "Move",
        },
        ctx(),
        randomUUID(),
      ),
    );
    expect(out.code).toBe("COUNT_IN_PROGRESS");
    // Into the counted location: ties are not in the count yet, but gloves going back in would be.
    const back = await err(
      transferStock(
        w.admin,
        {
          fromLocationId: w.ws.id,
          toLocationId: w.wh.id,
          lines: [{ itemId: w.gloves.id, quantity: 0 + 1 }],
          reason: "Back",
        },
        ctx(),
        randomUUID(),
      ),
    );
    expect(["COUNT_IN_PROGRESS", "INSUFFICIENT_STOCK"]).toContain(back.code);
  });

  it("does not block items outside the count, other locations, or closed counts", async () => {
    const w = await world();
    // Ties are not part of the WH-A count (no balance there when it was created).
    const r = await receiveStock(
      w.sup,
      { locationId: w.wh.id, lines: [{ itemId: w.ties.id, quantity: 3 }] },
      ctx(),
      randomUUID(),
    );
    expect(r.status).toBe(201);
    await issueStock(
      w.sup,
      { locationId: w.ws.id, lines: [{ itemId: w.ties.id, quantity: 2 }], recipientName: "Ana", purpose: "Job" },
      ctx(),
      randomUUID(),
    );
    await closeCountSession(w.sup, w.count.id, ctx());
    await issueStock(
      w.sup,
      { locationId: w.wh.id, lines: [{ itemId: w.gloves.id, quantity: 5 }], recipientName: "Juan", purpose: "Job" },
      ctx(),
      randomUUID(),
    );
    expect(await w.balance(w.gloves.id, w.wh.id)).toBe(45);
  });

  it("lets a supervisor go ahead with a recorded exception, and audits it", async () => {
    const w = await world();
    const r = await issueStock(
      w.sup,
      {
        locationId: w.wh.id,
        lines: [{ itemId: w.gloves.id, quantity: 5 }],
        recipientName: "Juan",
        purpose: "Urgent repair",
        countException: { reason: "Emergency repair at Site B" },
      },
      ctx(),
      randomUUID(),
    );
    expect(r.status).toBe(201);
    expect(await w.balance(w.gloves.id, w.wh.id)).toBe(45);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: "count.exception" } });
    expect(ev.recordId).toBe(w.count.id);
    expect(JSON.stringify(ev.after)).toContain("Emergency repair at Site B");
  });

  it("needs a real reason for an exception", async () => {
    const w = await world();
    const e = await err(
      issueStock(
        w.sup,
        {
          locationId: w.wh.id,
          lines: [{ itemId: w.gloves.id, quantity: 5 }],
          recipientName: "Juan",
          purpose: "Job",
          countException: { reason: "  " },
        },
        ctx(),
        randomUUID(),
      ),
    );
    expect(e.code).toBe("VALIDATION_FAILED");
  });
});
