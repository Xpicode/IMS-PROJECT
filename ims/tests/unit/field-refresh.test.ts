import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFieldDB, type FieldDB } from "@/lib/field/db";
import { saveBootstrap, saveCountDraft } from "@/lib/field/store";
import { refreshAssignments } from "@/lib/field/refresh";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

const boot = (id: string, version: number, targetVersion = 1) => ({
  session: {
    id,
    reference: `CNT-${id.slice(0, 4)}`,
    name: id === S1 ? "Open one" : "Closed one",
    status: "OPEN",
    dueAt: null,
    version,
    notes: null,
    location: { id: "loc", code: "WH-A", name: "Warehouse A" },
  },
  targets: [
    {
      id: `${id}-t`,
      kind: "STOCK" as const,
      version: targetVersion,
      item: { id: "i", sku: "SKU", name: "Item", unit: "pcs" },
      asset: null,
    },
  ],
  identifiers: [{ code: "SKU", targetId: `${id}-t` }],
  serverTime: new Date().toISOString(),
});

let db: FieldDB;
beforeEach(async () => {
  db = makeFieldDB("u-refresh");
  await db.open();
  await saveBootstrap(db, boot(S1, 1));
  await saveBootstrap(db, boot(S2, 1));
  await saveCountDraft(db, { sessionId: S1, targetId: `${S1}-t`, kind: "STOCK", quantity: 3, notes: "" });
  await saveCountDraft(db, { sessionId: S2, targetId: `${S2}-t`, kind: "STOCK", quantity: 4, notes: "" });
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const server = (mine: unknown[], boots: Record<string, unknown>) =>
  (async (url: string) => {
    if (url.startsWith("/api/v1/counts/mine")) return new Response(JSON.stringify({ data: mine }));
    const id = new URL(url, "http://x").searchParams.get("sessionId")!;
    return new Response(JSON.stringify(boots[id]));
  }) as typeof fetch;

it("re-downloads open assignments (new versions) and marks ones no longer assigned as closed, keeping counts", async () => {
  const r = await refreshAssignments(db, server([{ id: S1, version: 2 }], { [S1]: boot(S1, 2, 2) }));
  expect(r).toEqual({ updated: 1, closed: 1 });
  expect((await db.assignments.get(S1))!.serverVersion).toBe(2);
  expect((await db.targets.get(`${S1}-t`))!.version).toBe(2);
  expect((await db.assignments.get(S2))!.status).toBe("CLOSED");
  expect(await db.countDrafts.count()).toBe(2);
});

it("changes nothing when the server can't be reached", async () => {
  const down = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  expect(await refreshAssignments(db, down)).toBeNull();
  expect((await db.assignments.get(S2))!.status).toBe("OPEN");
});
