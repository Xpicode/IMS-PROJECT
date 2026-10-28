import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { issueStock, receiveStock } from "@/lib/inventory/stock";
import { createAssets } from "@/lib/assets/service";
import { closeCountSession, createCountSession } from "@/lib/counts/service";
import { pushOperations } from "@/lib/counts/sync";
import {
  approveLine,
  approveAllMatching,
  getReview,
  keepExpected,
  reopenCountSession,
  requestRecount,
} from "@/lib/counts/review";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function world() {
  const wh = await makeLocation("WH-A");
  const other = await makeLocation("WH-Z");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;
  const otherSup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: other.id }])).id))!;
  const field = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id))!;
  const field2 = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id))!;
  const gloves = await createItem(
    admin,
    { sku: "PPE-1", name: "Gloves", unitId: pcs.id, trackingType: "STOCK" },
    ctx(),
  );
  const ties = await createItem(admin, { sku: "ELC-1", name: "Ties", unitId: pcs.id, trackingType: "STOCK" }, ctx());
  const drill = await createItem(admin, { sku: "TOOL-D", name: "Drill", unitId: pcs.id, trackingType: "ASSET" }, ctx());
  await receiveStock(
    admin,
    {
      locationId: wh.id,
      lines: [
        { itemId: gloves.id, quantity: 120 },
        { itemId: ties.id, quantity: 40 },
      ],
    },
    ctx(),
    randomUUID(),
  );
  await createAssets(admin, { itemId: drill.id, locationId: wh.id, quantity: 2, tagPrefix: "TOOL" }, ctx());
  const s = await createCountSession(
    sup,
    { name: "Q4", locationId: wh.id, assigneeIds: [field.id, field2.id], includeStock: true, includeAssets: true },
    ctx(),
  );
  const targets = await prisma.countSessionItem.findMany({
    where: { sessionId: s.id },
    include: { item: true, asset: true },
  });
  const t = (k: string) => targets.find((x) => x.item.sku === k || x.asset?.tag === k)!;
  const count = async (who: typeof field, target: string, payload: object, baseVersion = 1) => {
    const r = await pushOperations(
      who,
      {
        deviceId: "d",
        operations: [
          {
            operationId: randomUUID(),
            type: "SUBMIT_COUNT",
            sessionId: s.id,
            targetId: t(target).id,
            baseVersion,
            payload,
          },
        ],
      },
      ctx(),
    );
    expect(r.results[0].status).toBe("ACKED");
  };
  const balance = async (itemId: string) =>
    (await prisma.stockBalance.findUniqueOrThrow({ where: { itemId_locationId: { itemId, locationId: wh.id } } }))
      .quantity;
  const ledger = async (itemId: string) =>
    (await prisma.stockMovement.aggregate({ where: { itemId, locationId: wh.id }, _sum: { quantity: true } }))._sum
      .quantity;
  return { wh, admin, sup, otherSup, field, field2, gloves, ties, s, t, count, balance, ledger };
}

const code = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, "expected an ApiError").toBeInstanceOf(ApiError);
  return (e as ApiError).code;
};

describe("count review (§7.7 step 8–9)", () => {
  it("lists every line with expected, counted, variance and a state", async () => {
    const w = await world();
    await w.count(w.field, "PPE-1", { quantity: 118, notes: "2 torn" });
    await w.count(w.field, "TOOL-0001", { found: true, condition: "GOOD" });
    const r = await getReview(w.sup, w.s.id);
    const line = (k: string) => r.lines.find((l) => l.sku === k || l.tag === k)!;
    expect(line("PPE-1")).toMatchObject({
      expected: 120,
      counted: 118,
      variance: -2,
      state: "READY",
      movedDuringCount: 0,
    });
    expect(line("PPE-1").entries).toEqual([
      expect.objectContaining({ quantity: 118, notes: "2 torn", counter: expect.any(String) }),
    ]);
    expect(line("ELC-1")).toMatchObject({ expected: 40, counted: null, state: "NOT_COUNTED" });
    expect(line("TOOL-0001")).toMatchObject({ state: "READY", variance: 0 });
    expect(r.summary).toMatchObject({ lines: 4, counted: 2, withDifference: 1, done: 0 });
    expect(r.counters.map((c) => c.counted).sort()).toEqual([0, 2]);
  });

  it("A20: approving one variance line posts exactly one auditable adjustment", async () => {
    const w = await world();
    await w.count(w.field, "PPE-1", { quantity: 118 });
    const r = await approveLine(w.sup, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID());
    expect(r.body).toMatchObject({
      decision: "APPROVED",
      variance: -2,
      adjustment: { reference: expect.stringMatching(/^ADJ-\d{4}-000001$/) },
    });
    const adj = await prisma.stockTransaction.findMany({ where: { type: "ADJUSTMENT" }, include: { movements: true } });
    expect(adj).toHaveLength(1);
    expect(adj[0].movements.map((m) => [m.quantity, m.balanceAfter])).toEqual([[-2, 118]]);
    expect(await w.balance(w.gloves.id)).toBe(118);
    expect(await w.ledger(w.gloves.id)).toBe(118);
    expect(await prisma.auditEvent.count({ where: { eventType: "count.approved" } })).toBe(1);
    expect((await prisma.countEntry.findFirstOrThrow()).status).toBe("ACCEPTED");
  });

  it("A21: repeating an approval never posts a second adjustment", async () => {
    const w = await world();
    await w.count(w.field, "PPE-1", { quantity: 118 });
    const key = randomUUID();
    const first = await approveLine(w.sup, w.s.id, w.t("PPE-1").id, {}, ctx(), key);
    const replay = await approveLine(w.sup, w.s.id, w.t("PPE-1").id, {}, ctx(), key);
    expect(replay.body).toEqual(first.body);
    expect(await code(approveLine(w.sup, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()))).toBe("CONFLICT");
    const both = await Promise.allSettled([
      approveLine(w.admin, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()),
      approveLine(w.admin, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()),
    ]);
    expect(both.every((x) => x.status === "rejected")).toBe(true);
    expect(await prisma.stockTransaction.count({ where: { type: "ADJUSTMENT" } })).toBe(1);
    expect(await w.balance(w.gloves.id)).toBe(118);
  });

  it("A21: two first-time approvals racing still post one adjustment", async () => {
    const w = await world();
    await w.count(w.field, "PPE-1", { quantity: 125 });
    const both = await Promise.allSettled([
      approveLine(w.sup, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()),
      approveLine(w.admin, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()),
    ]);
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.stockTransaction.count({ where: { type: "ADJUSTMENT" } })).toBe(1);
    expect(await w.balance(w.gloves.id)).toBe(125);
  });

  it("a zero difference is approved without any adjustment; bulk approve takes only zero-difference lines", async () => {
    const w = await world();
    await w.count(w.field, "PPE-1", { quantity: 120 });
    await w.count(w.field, "ELC-1", { quantity: 39 });
    await w.count(w.field, "TOOL-0001", { found: true, condition: "GOOD" });
    await w.count(w.field, "TOOL-0002", { found: false });
    const r = await approveAllMatching(w.sup, w.s.id, ctx());
    expect(r.approved).toBe(2);
    expect(await prisma.stockTransaction.count({ where: { type: "ADJUSTMENT" } })).toBe(0);
    const review = await getReview(w.sup, w.s.id);
    expect(
      review.lines
        .filter((l) => l.state === "DONE")
        .map((l) => l.sku ?? l.tag)
        .sort(),
    ).toEqual(["PPE-1", "TOOL-0001"]);
    expect(review.lines.find((l) => l.sku === "ELC-1")!.state).toBe("READY");
  });

  it("blocks approval when stock moved during the count; a recount re-takes expected and then approves correctly", async () => {
    const w = await world();
    await w.count(w.field, "PPE-1", { quantity: 118 });
    await issueStock(
      w.sup,
      {
        locationId: w.wh.id,
        lines: [{ itemId: w.gloves.id, quantity: 10 }],
        recipientName: "Juan",
        purpose: "Urgent",
        countException: { reason: "Emergency job" },
      },
      ctx(),
      randomUUID(),
    );
    const before = await getReview(w.sup, w.s.id);
    expect(before.lines.find((l) => l.sku === "PPE-1")).toMatchObject({ state: "MOVED", movedDuringCount: -10 });
    expect(await code(approveLine(w.sup, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()))).toBe("CONFLICT");

    await requestRecount(w.sup, w.s.id, w.t("PPE-1").id, ctx());
    // The session version goes up too, so phones see there is something new to download.
    expect((await prisma.countSession.findUniqueOrThrow({ where: { id: w.s.id } })).version).toBe(2);
    const after = await getReview(w.sup, w.s.id);
    expect(after.lines.find((l) => l.sku === "PPE-1")).toMatchObject({
      expected: 110,
      counted: null,
      state: "RECOUNT",
      movedDuringCount: 0,
      version: 2,
    });
    await w.count(w.field, "PPE-1", { quantity: 107 }, 2);
    const r = await approveLine(w.sup, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID());
    expect(r.body.variance).toBe(-3);
    expect(await w.balance(w.gloves.id)).toBe(107);
    expect(await w.ledger(w.gloves.id)).toBe(107);
  });

  it("A18: two counters who disagree must be resolved by picking one (or a recount)", async () => {
    const w = await world();
    await w.count(w.field, "PPE-1", { quantity: 118 });
    await w.count(w.field2, "PPE-1", { quantity: 112 });
    const line = (await getReview(w.sup, w.s.id)).lines.find((l) => l.sku === "PPE-1")!;
    expect(line).toMatchObject({ state: "DISAGREE", counted: null });
    expect(line.entries.map((e) => e.quantity).sort()).toEqual([112, 118]);
    expect(await code(approveLine(w.sup, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()))).toBe("CONFLICT");
    const pick = line.entries.find((e) => e.quantity === 112)!;
    const r = await approveLine(w.sup, w.s.id, w.t("PPE-1").id, { entryId: pick.id }, ctx(), randomUUID());
    expect(r.body.variance).toBe(-8);
    expect(await w.balance(w.gloves.id)).toBe(112);
  });

  it("keep expected changes nothing and closes the line", async () => {
    const w = await world();
    await w.count(w.field, "PPE-1", { quantity: 118 });
    await keepExpected(w.sup, w.s.id, w.t("PPE-1").id, { notes: "Counter missed a box" }, ctx());
    expect(await w.balance(w.gloves.id)).toBe(120);
    expect(await prisma.stockTransaction.count({ where: { type: "ADJUSTMENT" } })).toBe(0);
    expect(await code(approveLine(w.sup, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()))).toBe("CONFLICT");
  });

  it("refuses to approve a line nobody counted", async () => {
    const w = await world();
    expect(await code(approveLine(w.sup, w.s.id, w.t("ELC-1").id, {}, ctx(), randomUUID()))).toBe("VALIDATION_FAILED");
  });

  it("assets: approving 'not found' marks the asset Lost; a new condition is recorded", async () => {
    const w = await world();
    await w.count(w.field, "TOOL-0001", { found: false, notes: "Not in the cage" });
    await w.count(w.field, "TOOL-0002", { found: true, condition: "DAMAGED" });
    await approveLine(w.sup, w.s.id, w.t("TOOL-0001").id, {}, ctx(), randomUUID());
    await approveLine(w.sup, w.s.id, w.t("TOOL-0002").id, {}, ctx(), randomUUID());
    const a1 = await prisma.asset.findUniqueOrThrow({ where: { tag: "TOOL-0001" } });
    const a2 = await prisma.asset.findUniqueOrThrow({ where: { tag: "TOOL-0002" } });
    expect([a1.status, a1.version]).toEqual(["LOST", 2]);
    expect([a2.status, a2.condition]).toEqual(["AVAILABLE", "DAMAGED"]);
    const ev = await prisma.assetEvent.findMany({
      where: { eventType: "count.approved" },
      orderBy: { createdAt: "asc" },
    });
    expect(ev.map((e) => [e.toStatus, e.toCondition])).toEqual([
      ["LOST", null],
      [null, "DAMAGED"],
    ]);
  });

  it("recount needs an open session; closing then reopening allows it", async () => {
    const w = await world();
    await closeCountSession(w.sup, w.s.id, ctx());
    expect(await code(requestRecount(w.sup, w.s.id, w.t("PPE-1").id, ctx()))).toBe("CONFLICT");
    await reopenCountSession(w.sup, w.s.id, ctx());
    await requestRecount(w.sup, w.s.id, w.t("PPE-1").id, ctx());
    expect((await prisma.countSessionItem.findUniqueOrThrow({ where: { id: w.t("PPE-1").id } })).version).toBe(2);
  });

  it("only supervisors/admins of that location can review", async () => {
    const w = await world();
    await w.count(w.field, "PPE-1", { quantity: 118 });
    expect(await code(approveLine(w.field, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()))).toBe("FORBIDDEN");
    expect(await code(approveLine(w.otherSup, w.s.id, w.t("PPE-1").id, {}, ctx(), randomUUID()))).toBe("NOT_FOUND");
    expect(await code(getReview(w.otherSup, w.s.id))).toBe("NOT_FOUND");
    expect(await code(getReview(w.field, w.s.id))).toBe("FORBIDDEN");
    expect(await w.balance(w.gloves.id)).toBe(120);
  });
});
