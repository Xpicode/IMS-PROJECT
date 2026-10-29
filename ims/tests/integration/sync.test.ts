import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { receiveStock } from "@/lib/inventory/stock";
import { createAssets } from "@/lib/assets/service";
import { closeCountSession, createCountSession } from "@/lib/counts/service";
import { pushOperations, type PushOperation, type PushResult } from "@/lib/counts/sync";

/** A non-ACKED result (has code/message/nextAction). */
const bad = (r: PushResult) => r as Extract<PushResult, { code: string }>;
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function world() {
  const wh = await makeLocation("WH-A");
  const site = await makeLocation("SITE-B", "SITE");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;
  const field = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id))!;
  const field2 = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id))!;
  const gloves = await createItem(
    admin,
    { sku: "PPE-0001", name: "Safety Gloves", unitId: pcs.id, trackingType: "STOCK" },
    ctx(),
  );
  const drill = await createItem(
    admin,
    { sku: "TOOL-DRILL", name: "Drill", unitId: pcs.id, trackingType: "ASSET" },
    ctx(),
  );
  await receiveStock(admin, { locationId: wh.id, lines: [{ itemId: gloves.id, quantity: 120 }] }, ctx(), randomUUID());
  await createAssets(admin, { itemId: drill.id, locationId: wh.id, quantity: 1, tagPrefix: "TOOL" }, ctx());
  const session = await createCountSession(
    sup,
    {
      name: "Q4",
      locationId: wh.id,
      assigneeIds: [field.id, field2.id],
      includeStock: true,
      includeAssets: true,
    },
    ctx(),
  );
  const targets = await prisma.countSessionItem.findMany({ where: { sessionId: session.id } });
  const stockT = targets.find((t) => t.kind === "STOCK")!;
  const assetT = targets.find((t) => t.kind === "ASSET")!;
  return { wh, site, admin, sup, field, field2, session, stockT, assetT };
}

type W = Awaited<ReturnType<typeof world>>;

const stockOp = (w: W, quantity: number, extra: Partial<PushOperation> = {}): PushOperation => ({
  operationId: randomUUID(),
  type: "SUBMIT_COUNT",
  sessionId: w.session.id,
  targetId: w.stockT.id,
  baseVersion: 1,
  clientRecordedAt: new Date().toISOString(),
  payload: { quantity, notes: "" },
  ...extra,
});

const push = (actor: W["field"], operations: unknown[]) =>
  pushOperations(actor, { deviceId: "device-1", operations }, ctx());

describe("POST /sync/push: saving counts (§11.4)", () => {
  it("acknowledges a stock count and an asset check and stores them with an audit event", async () => {
    const w = await world();
    const a = stockOp(w, 118, { payload: { quantity: 118, notes: "Two torn" } });
    const b: PushOperation = {
      operationId: randomUUID(),
      type: "SUBMIT_COUNT",
      sessionId: w.session.id,
      targetId: w.assetT.id,
      baseVersion: 1,
      payload: { found: true, condition: "DAMAGED", notes: "" },
    };
    const r = await push(w.field, [a, b]);
    expect(r.results.map((x) => [x.operationId, x.status])).toEqual([
      [a.operationId, "ACKED"],
      [b.operationId, "ACKED"],
    ]);
    expect(r.results[0]).toMatchObject({ serverVersion: 1 });
    const entries = await prisma.countEntry.findMany({ orderBy: { createdAt: "asc" } });
    expect(entries.map((e) => [e.quantity, e.found, e.condition, e.status, e.counterId])).toEqual([
      [118, null, null, "SUBMITTED", w.field.id],
      [null, true, "DAMAGED", "SUBMITTED", w.field.id],
    ]);
    expect(entries[0].notes).toBe("Two torn");
    expect(r.results[0]).toMatchObject({ serverRecordId: entries[0].id });
    expect(await prisma.syncOperation.count({ where: { userId: w.field.id, result: "ACKED" } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { eventType: "count.submitted" } })).toBe(2);
    // A count is an observation, never a stock movement (§11.1 rule 2).
    expect((await prisma.stockBalance.findFirstOrThrow()).quantity).toBe(120);
  });

  it("A16: the same operation sent again returns the stored answer and saves nothing new", async () => {
    const w = await world();
    const op = stockOp(w, 118);
    const first = await push(w.field, [op]);
    const again = await push(w.field, [op]);
    expect(again.results).toEqual(first.results);
    expect(await prisma.countEntry.count()).toBe(1);
  });

  it("A16: two copies of one operation arriving at the same time save one count", async () => {
    const w = await world();
    const op = stockOp(w, 118);
    const [x, y] = await Promise.all([push(w.field, [op]), push(w.field, [op])]);
    expect(x.results[0].status).toBe("ACKED");
    expect(y.results).toEqual(x.results);
    expect(await prisma.countEntry.count()).toBe(1);
  });

  it("A17: the same operation ID with changed content is rejected and the original kept", async () => {
    const w = await world();
    const op = stockOp(w, 118);
    await push(w.field, [op]);
    const r = await push(w.field, [{ ...op, payload: { quantity: 5000, notes: "" } }]);
    expect(r.results[0]).toMatchObject({ status: "REJECTED", code: "OPERATION_REUSED" });
    const entries = await prisma.countEntry.findMany();
    expect(entries.map((e) => e.quantity)).toEqual([118]);
    expect(await prisma.auditEvent.count({ where: { eventType: "sync.operation_reused" } })).toBe(1);
  });

  it("a new count from the same person replaces their earlier one (older entry superseded)", async () => {
    const w = await world();
    await push(w.field, [stockOp(w, 118)]);
    await push(w.field, [stockOp(w, 119)]);
    const entries = await prisma.countEntry.findMany({ orderBy: { createdAt: "asc" } });
    expect(entries.map((e) => [e.quantity, e.status])).toEqual([
      [118, "SUPERSEDED"],
      [119, "SUBMITTED"],
    ]);
  });

  it("the same person sending two counts for one line at the same moment ends with exactly one current count", async () => {
    const w = await world();
    for (let round = 0; round < 5; round++) {
      const rs = await Promise.all([
        push(w.field, [stockOp(w, 100 + round)]),
        push(w.field, [stockOp(w, 200 + round)]),
      ]);
      expect(rs.map((r) => r.results[0].status)).toEqual(["ACKED", "ACKED"]);
    }
    const current = await prisma.countEntry.count({ where: { counterId: w.field.id, status: "SUBMITTED" } });
    expect(current).toBe(1);
    expect(await prisma.countEntry.count({ where: { status: "SUPERSEDED" } })).toBe(9);
  });

  it("closing while counts arrive: every count is saved before the close or answered SESSION_CLOSED, none lost", async () => {
    const w = await world();
    const ops = Array.from({ length: 12 }, (_, i) => [i % 2 ? w.field : w.field2, stockOp(w, 300 + i)] as const);
    const [closed, ...rs] = await Promise.all([
      new Promise((r) => setTimeout(r, 15)).then(() => closeCountSession(w.sup, w.session.id, ctx())),
      ...ops.map(([u, op]) => push(u, [op])),
    ]);
    expect(closed).toBeTruthy();
    const statuses = rs.map((r) => r.results[0]);
    const acked = statuses.filter((r) => r.status === "ACKED").length;
    const closedOnes = statuses.filter((r) => r.status === "CONFLICT" && bad(r).code === "SESSION_CLOSED").length;
    expect(acked + closedOnes).toBe(ops.length);
    expect(await prisma.countEntry.count()).toBe(acked);
    const s = await prisma.countSession.findUniqueOrThrow({ where: { id: w.session.id } });
    const late = await prisma.countEntry.count({ where: { createdAt: { gt: s.closedAt! } } });
    expect(late).toBe(0);
  });

  it("two closes at the same moment: one closes, the other is told it's already closed", async () => {
    const w = await world();
    const rs = await Promise.allSettled([
      closeCountSession(w.sup, w.session.id, ctx()),
      closeCountSession(w.sup, w.session.id, ctx()),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const no = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(no.reason).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already closed/) });
    expect(await prisma.auditEvent.count({ where: { eventType: "count.closed" } })).toBe(1);
  });

  it("a count doesn't wait for other people's counts that are still being saved (no session-wide queue)", async () => {
    const w = await world();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    // Another phone's submission is in progress and holds what a submission holds on the session.
    const other = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM count_sessions WHERE id = ${w.session.id}::uuid FOR SHARE`;
        await held;
      },
      { timeout: 20_000 },
    );
    const timer = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 4000));
    const outcome = await Promise.race([push(w.field, [stockOp(w, 118)]), timer]);
    release();
    await other;
    expect(outcome).not.toBe("timeout");
  });

  it("A18: two people counting the same line keep two separate observations", async () => {
    const w = await world();
    await push(w.field, [stockOp(w, 118)]);
    await push(w.field2, [stockOp(w, 112)]);
    const entries = await prisma.countEntry.findMany({ orderBy: { quantity: "asc" } });
    expect(entries.map((e) => [e.quantity, e.status, e.counterId])).toEqual([
      [112, "SUBMITTED", w.field2.id],
      [118, "SUBMITTED", w.field.id],
    ]);
  });

  it("A19: a count arriving after the session was closed is a conflict, stored, and not saved as a count", async () => {
    const w = await world();
    await closeCountSession(w.sup, w.session.id, ctx());
    const op = stockOp(w, 118);
    const r = await push(w.field, [op]);
    expect(r.results[0]).toMatchObject({ status: "CONFLICT", code: "SESSION_CLOSED" });
    expect(bad(r.results[0]).message).toMatch(/closed/i);
    expect(bad(r.results[0]).nextAction).toMatch(/supervisor/i);
    expect(await prisma.countEntry.count()).toBe(0);
    // The evidence is kept on the server too (audit), and a retry gets the same answer.
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: "count.conflict" } });
    expect(JSON.stringify(ev.after)).toContain("118");
    expect((await push(w.field, [op])).results).toEqual(r.results);
  });

  it("a count made before a recount was requested comes back as a conflict", async () => {
    const w = await world();
    await prisma.countSessionItem.update({
      where: { id: w.stockT.id },
      data: { version: 2, recountRequested: true },
    });
    const r = await push(w.field, [stockOp(w, 118)]);
    expect(r.results[0]).toMatchObject({ status: "CONFLICT", code: "RECOUNT_REQUESTED", serverVersion: 2 });
    expect(await prisma.countEntry.count()).toBe(0);
    const ok = await push(w.field, [stockOp(w, 117, { baseVersion: 2 })]);
    expect(ok.results[0].status).toBe("ACKED");
  });
});

describe("POST /sync/push: permissions at the moment of upload (A28, §11.1 rule 8)", () => {
  it("rejects counts from someone who lost access to the location while offline", async () => {
    const w = await world();
    await prisma.userLocation.updateMany({ where: { userId: w.field.id }, data: { locationId: w.site.id } });
    const moved = (await loadAccessUser(w.field.id))!;
    const r = await push(moved, [stockOp(w, 118)]);
    expect(r.results[0]).toMatchObject({ status: "REJECTED", code: "FORBIDDEN" });
    expect(bad(r.results[0]).nextAction).toMatch(/supervisor|administrator/i);
    expect(await prisma.countEntry.count()).toBe(0);
  });

  it("rejects counts from someone removed from the count", async () => {
    const w = await world();
    await prisma.countSessionAssignee.delete({
      where: { sessionId_userId: { sessionId: w.session.id, userId: w.field.id } },
    });
    const r = await push(w.field, [stockOp(w, 118)]);
    expect(r.results[0]).toMatchObject({ status: "REJECTED", code: "FORBIDDEN" });
    expect(await prisma.countEntry.count()).toBe(0);
  });

  it("refuses the whole request from a deactivated account, so nothing is stored", async () => {
    const w = await world();
    await prisma.user.update({ where: { id: w.field.id }, data: { status: "INACTIVE" } });
    const off = (await loadAccessUser(w.field.id))!;
    const e = await push(off, [stockOp(w, 118)]).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(await prisma.syncOperation.count()).toBe(0);
  });
});

describe("POST /sync/push: each operation stands alone", () => {
  it("rejects a bad operation without blocking the good ones, in the order sent", async () => {
    const w = await world();
    const good1 = stockOp(w, 10);
    const negative = stockOp(w, -1);
    const wrongShape = stockOp(w, 5, { targetId: w.assetT.id }); // quantity sent for an asset
    const foreign = stockOp(w, 5, { targetId: randomUUID() });
    const good2: PushOperation = {
      operationId: randomUUID(),
      type: "SUBMIT_COUNT",
      sessionId: w.session.id,
      targetId: w.assetT.id,
      baseVersion: 1,
      payload: { found: false, notes: "Not on the shelf" },
    };
    const r = await push(w.field, [good1, negative, wrongShape, foreign, { junk: true }, good2]);
    expect(r.results.map((x) => x.status)).toEqual(["ACKED", "REJECTED", "REJECTED", "REJECTED", "REJECTED", "ACKED"]);
    expect(bad(r.results[1]).code).toBe("VALIDATION_FAILED");
    expect(r.results[4].operationId).toBeNull();
    expect(await prisma.countEntry.count()).toBe(2);
  });

  it("accepts at most 50 operations per request", async () => {
    const w = await world();
    const ops = Array.from({ length: 51 }, () => stockOp(w, 1));
    const e = await push(w.field, ops).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("VALIDATION_FAILED");
    expect(await prisma.countEntry.count()).toBe(0);
  });
});
