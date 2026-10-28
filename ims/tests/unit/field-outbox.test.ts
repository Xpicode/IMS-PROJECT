import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFieldDB, type FieldDB } from "@/lib/field/db";
import { saveBootstrap, saveCountDraft } from "@/lib/field/store";
import { syncNow, submitDrafts, syncSummary, sendAgain, type SyncDeps } from "@/lib/field/outbox";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S1 = "11111111-1111-4111-8111-111111111111";

function bootstrap(n = 3) {
  return {
    session: {
      id: S1,
      reference: "CNT-2026-000001",
      name: "Q4",
      status: "OPEN",
      dueAt: null,
      version: 1,
      notes: null,
      location: { id: "loc", code: "WH-A", name: "Warehouse A" },
    },
    targets: Array.from({ length: n }, (_, i) => ({
      id: `t-${i}`,
      kind: "STOCK" as const,
      version: 1,
      item: { id: `i-${i}`, sku: `SKU-${i}`, name: `Item ${i}`, unit: "pcs" },
      asset: null,
    })),
    identifiers: [],
    serverTime: new Date().toISOString(),
  };
}

type Op = { operationId: string; targetId: string; payload: { quantity: number } };

/** An in-memory server that behaves like /sync/push: idempotent by operation ID. */
function fakeServer(decide: (op: Op) => "ACKED" | "CONFLICT" | "REJECTED" | "RETRYABLE_ERROR" = () => "ACKED") {
  const stored = new Map<string, unknown>();
  const server = {
    calls: [] as Op[][],
    saved: [] as Op[],
    down: false,
    /** Process the request but lose the response (A16). */
    loseResponse: false,
    fetch: async (_url: string, init?: RequestInit) => {
      if (server.down) throw new TypeError("Failed to fetch");
      const body = JSON.parse(String(init?.body)) as { deviceId: string; operations: Op[] };
      server.calls.push(body.operations);
      const results = body.operations.map((op) => {
        if (stored.has(op.operationId)) return stored.get(op.operationId);
        const status = decide(op);
        const r =
          status === "ACKED"
            ? { operationId: op.operationId, status, serverRecordId: `e-${op.operationId}`, serverVersion: 1 }
            : { operationId: op.operationId, status, code: "X", message: `${status} msg`, nextAction: "Do this" };
        if (status !== "RETRYABLE_ERROR") stored.set(op.operationId, r);
        if (status === "ACKED") server.saved.push(op);
        return r;
      });
      if (server.loseResponse) {
        server.loseResponse = false;
        throw new TypeError("Network connection lost");
      }
      return new Response(JSON.stringify({ results, serverTime: new Date().toISOString() }), { status: 200 });
    },
  };
  return server;
}

let db: FieldDB;
beforeEach(async () => {
  db = makeFieldDB(ME);
  await db.open();
  await db.syncMeta.put({ id: "meta", userId: ME, deviceId: "dev-1", schemaVersion: 1 });
  await saveBootstrap(db, bootstrap());
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const deps = (server: ReturnType<typeof fakeServer>, who: string | "signed-out" | "offline" = ME): SyncDeps => ({
  userId: ME,
  fetch: server.fetch as typeof fetch,
  whoAmI: async () =>
    who === "signed-out" || who === "offline"
      ? { state: who }
      : { state: "online", user: { id: who, name: "X", role: "FIELD" } },
});

async function countAll(n = 3) {
  for (let i = 0; i < n; i++)
    await saveCountDraft(db, { sessionId: S1, targetId: `t-${i}`, kind: "STOCK", quantity: 10 + i, notes: "" });
}

describe("Send counts (outbox, §11.2)", () => {
  it("freezes each new count into one operation; tapping twice queues nothing more (§11.5)", async () => {
    await countAll();
    expect(await submitDrafts(db, ME, S1)).toBe(3);
    expect(await submitDrafts(db, ME, S1)).toBe(0);
    const ops = await db.outbox.toArray();
    expect(ops.map((o) => o.status)).toEqual(["PENDING", "PENDING", "PENDING"]);
    expect(new Set(ops.map((o) => o.operationId)).size).toBe(3);
    expect(ops.find((o) => o.targetId === "t-1")!.payload).toMatchObject({
      type: "SUBMIT_COUNT",
      sessionId: S1,
      targetId: "t-1",
      baseVersion: 1,
      payload: { quantity: 11 },
    });
    expect(await syncSummary(db)).toMatchObject({ notSent: 3, attention: 0, received: 0 });
  });

  it("an edit after sending becomes a new operation; the sent one is never changed", async () => {
    await countAll(1);
    await submitDrafts(db, ME, S1);
    const [first] = await db.outbox.toArray();
    await saveCountDraft(db, { sessionId: S1, targetId: "t-0", kind: "STOCK", quantity: 99, notes: "" });
    expect(await syncSummary(db)).toMatchObject({ notSent: 1 });
    expect(await submitDrafts(db, ME, S1)).toBe(1);
    const ops = await db.outbox.orderBy("seq").toArray();
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual(first);
    expect(ops[1].operationId).not.toBe(first.operationId);
    expect((ops[1].payload as Op).payload.quantity).toBe(99);
  });
});

describe("Sync now", () => {
  it("A15: clears only acknowledged counts; conflicts stay visible with the server's explanation", async () => {
    await countAll();
    await submitDrafts(db, ME, S1);
    const server = fakeServer((op) => (op.targetId === "t-2" ? "CONFLICT" : "ACKED"));
    const r = await syncNow(db, deps(server));
    expect(r).toMatchObject({ state: "done", acked: 2, conflicts: 1, failed: 0 });
    const byTarget = Object.fromEntries((await db.outbox.toArray()).map((o) => [o.targetId, o]));
    expect(byTarget["t-0"].status).toBe("ACKED");
    expect(byTarget["t-2"]).toMatchObject({
      status: "CONFLICT",
      result: { message: "CONFLICT msg", nextAction: "Do this" },
    });
    expect(await syncSummary(db)).toMatchObject({ notSent: 0, received: 2, attention: 1 });
    // The count itself is still on the phone.
    expect(await db.countDrafts.count()).toBe(3);
  });

  it("A16: if the response is lost, the retry reuses the same IDs and the server saves each once", async () => {
    await countAll();
    await submitDrafts(db, ME, S1);
    const server = fakeServer();
    server.loseResponse = true;
    const r1 = await syncNow(db, deps(server));
    expect(r1.state).toBe("failed");
    expect((await db.outbox.toArray()).every((o) => o.status === "FAILED")).toBe(true);
    expect(await syncSummary(db)).toMatchObject({ notSent: 3 });
    const r2 = await syncNow(db, deps(server));
    expect(r2).toMatchObject({ state: "done", acked: 3 });
    expect(server.calls[1].map((o) => o.operationId)).toEqual(server.calls[0].map((o) => o.operationId));
    expect(server.saved).toHaveLength(3);
  });

  it("re-sends SENDING operations left over when the app was closed mid-send, with their original ID (§11.5)", async () => {
    await countAll(1);
    await submitDrafts(db, ME, S1);
    const [op] = await db.outbox.toArray();
    await db.outbox.update(op.operationId, { status: "SENDING", attempts: 1 });
    const server = fakeServer();
    await syncNow(db, deps(server));
    expect(server.calls[0].map((o) => o.operationId)).toEqual([op.operationId]);
    expect((await db.outbox.get(op.operationId))!.status).toBe("ACKED");
  });

  it("keeps the queue when the site is down (§11.5)", async () => {
    await countAll();
    await submitDrafts(db, ME, S1);
    const server = fakeServer();
    server.down = true;
    expect((await syncNow(db, deps(server))).state).toBe("failed");
    const ops = await db.outbox.toArray();
    expect(ops.map((o) => [o.status, o.attempts])).toEqual([
      ["FAILED", 1],
      ["FAILED", 1],
      ["FAILED", 1],
    ]);
    expect(ops[0].lastError).toMatch(/reach the server/i);
  });

  it("server errors marked RETRYABLE_ERROR stay queued for the next try", async () => {
    await countAll(1);
    await submitDrafts(db, ME, S1);
    let n = 0;
    const server = fakeServer(() => (n++ === 0 ? "RETRYABLE_ERROR" : "ACKED"));
    expect(await syncNow(db, deps(server))).toMatchObject({ failed: 1 });
    expect(await syncSummary(db)).toMatchObject({ notSent: 1 });
    expect(await syncNow(db, deps(server))).toMatchObject({ acked: 1 });
  });

  it("never sends under a different account, or when signed out (§10.5)", async () => {
    await countAll();
    await submitDrafts(db, ME, S1);
    const server = fakeServer();
    expect((await syncNow(db, deps(server, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))).state).toBe("wrong-user");
    expect((await syncNow(db, deps(server, "signed-out"))).state).toBe("signed-out");
    expect((await syncNow(db, deps(server, "offline"))).state).toBe("offline");
    expect(server.calls).toHaveLength(0);
    expect((await db.outbox.toArray()).every((o) => o.status === "PENDING")).toBe(true);
  });

  it("sends at most 50 operations per request", async () => {
    await saveBootstrap(db, bootstrap(120));
    await countAll(120);
    await submitDrafts(db, ME, S1);
    const server = fakeServer();
    expect(await syncNow(db, deps(server))).toMatchObject({ acked: 120 });
    expect(server.calls.map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it("'Send again' turns a rejected or conflicting count into a new operation", async () => {
    await countAll(1);
    await submitDrafts(db, ME, S1);
    const server = fakeServer(() => "REJECTED");
    await syncNow(db, deps(server));
    const [bad] = await db.outbox.toArray();
    expect(bad.status).toBe("REJECTED");
    await sendAgain(db, ME, bad.operationId);
    const ops = await db.outbox.orderBy("seq").toArray();
    expect(ops.map((o) => o.status)).toEqual(["REJECTED", "PENDING"]);
    expect(ops[1].operationId).not.toBe(bad.operationId);
    expect(await syncSummary(db)).toMatchObject({ notSent: 1, attention: 0 });
  });
});
