import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFieldDB, type FieldDB } from "@/lib/field/db";
import {
  findTargets,
  FieldStorageError,
  getDraft,
  listDrafts,
  pendingCount,
  progress,
  saveBootstrap,
  saveCountDraft,
  toStorageError,
} from "@/lib/field/store";

const S1 = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";

function bootstrap(sessionId = S1, n = 2) {
  const targets = [
    {
      id: "t-gloves",
      kind: "STOCK" as const,
      version: 1,
      item: { id: ITEM, sku: "PPE-0001", name: "Safety Gloves", unit: "pair" },
      asset: null,
    },
    {
      id: "t-drill",
      kind: "ASSET" as const,
      version: 1,
      item: { id: "i-drill", sku: "TOOL-DRILL", name: "Cordless Drill", unit: "pcs" },
      asset: { id: ASSET, tag: "TOOL-0001", serialNumber: "SN-1", status: "AVAILABLE", condition: "GOOD" },
    },
    ...Array.from({ length: Math.max(0, n - 2) }, (_, i) => ({
      id: `t-${i}`,
      kind: "STOCK" as const,
      version: 1,
      item: { id: `item-${i}`, sku: `BULK-${String(i).padStart(4, "0")}`, name: `Bulk item ${i}`, unit: "pcs" },
      asset: null,
    })),
  ];
  return {
    session: {
      id: sessionId,
      reference: "CNT-2026-000001",
      name: "Q4 count",
      status: "OPEN",
      dueAt: null,
      version: 1,
      notes: null,
      location: { id: "loc", code: "WH-A", name: "Main" },
    },
    targets,
    identifiers: [
      { code: "PPE-0001", targetId: "t-gloves" },
      { code: `ims:item:${ITEM}`, targetId: "t-gloves" },
      { code: "036000291452", targetId: "t-gloves" },
      { code: "TOOL-0001", targetId: "t-drill" },
      { code: `ims:asset:${ASSET}`, targetId: "t-drill" },
      ...targets.slice(2).map((t) => ({ code: t.item.sku, targetId: t.id })),
    ],
    serverTime: new Date().toISOString(),
  };
}

let db: FieldDB;
let name = 0;
beforeEach(async () => {
  db = makeFieldDB(`user-${++name}`);
  await db.open();
});
afterEach(async () => {
  db.close();
});

describe("download (bootstrap) into the device", () => {
  it("stores the assignment, its targets, and lookup codes", async () => {
    await saveBootstrap(db, bootstrap());
    const a = await db.assignments.get(S1);
    expect(a).toMatchObject({ name: "Q4 count", targetCount: 2, serverVersion: 1 });
    expect(await db.targets.where("sessionId").equals(S1).count()).toBe(2);
  });

  it("re-downloading keeps counts already made on the device", async () => {
    await saveBootstrap(db, bootstrap());
    await saveCountDraft(db, { sessionId: S1, targetId: "t-gloves", kind: "STOCK", quantity: 98, notes: "" });
    await saveBootstrap(db, bootstrap());
    expect((await getDraft(db, S1, "t-gloves"))?.quantity).toBe(98);
  });
});

describe("scan lookup (offline)", () => {
  it("finds a target by SKU, label QR, tag, or barcode, case-insensitively", async () => {
    await saveBootstrap(db, bootstrap());
    expect((await findTargets(db, S1, " ppe-0001 ")).map((t) => t.id)).toEqual(["t-gloves"]);
    expect((await findTargets(db, S1, `ims:item:${ITEM.toUpperCase()}`)).map((t) => t.id)).toEqual(["t-gloves"]);
    expect((await findTargets(db, S1, "tool-0001")).map((t) => t.id)).toEqual(["t-drill"]);
    expect((await findTargets(db, S1, "0036000291452")).map((t) => t.id)).toEqual(["t-gloves"]); // UPC read as EAN-13
    expect(await findTargets(db, S1, "NOPE")).toEqual([]);
  });

  it("searches every downloaded assignment when none is open", async () => {
    await saveBootstrap(db, bootstrap());
    const r = await findTargets(db, null, "TOOL-0001");
    expect(r.map((t) => [t.sessionId, t.id])).toEqual([[S1, "t-drill"]]);
  });
});

describe("saving counts", () => {
  it("A12: counting the same item again replaces the count, never adds to it", async () => {
    await saveBootstrap(db, bootstrap());
    await saveCountDraft(db, { sessionId: S1, targetId: "t-gloves", kind: "STOCK", quantity: 98, notes: "" });
    const again = await saveCountDraft(db, {
      sessionId: S1,
      targetId: "t-gloves",
      kind: "STOCK",
      quantity: 98,
      notes: "Two damaged",
    });
    expect(again).toMatchObject({ quantity: 98, notes: "Two damaged", saveCount: 2 });
    expect(await db.countDrafts.count()).toBe(1);
  });

  it("asset check: found with condition, or not found (no condition)", async () => {
    await saveBootstrap(db, bootstrap());
    const f = await saveCountDraft(db, {
      sessionId: S1,
      targetId: "t-drill",
      kind: "ASSET",
      found: true,
      condition: "DAMAGED",
      notes: "Cracked case",
    });
    expect(f).toMatchObject({ found: true, condition: "DAMAGED", quantity: null });
    const nf = await saveCountDraft(db, {
      sessionId: S1,
      targetId: "t-drill",
      kind: "ASSET",
      found: false,
      condition: "GOOD",
      notes: "",
    });
    expect(nf).toMatchObject({ found: false, condition: null });
  });

  it("rejects bad input before touching storage", async () => {
    await saveBootstrap(db, bootstrap());
    await expect(
      saveCountDraft(db, { sessionId: S1, targetId: "t-gloves", kind: "STOCK", quantity: -1, notes: "" }),
    ).rejects.toThrow(/0 or more/);
    await expect(
      saveCountDraft(db, { sessionId: S1, targetId: "t-gloves", kind: "STOCK", quantity: 1.5, notes: "" }),
    ).rejects.toThrow(/whole number/);
    await expect(
      saveCountDraft(db, { sessionId: S1, targetId: "t-drill", kind: "ASSET", found: true, notes: "" }),
    ).rejects.toThrow(/condition/i);
    await expect(
      saveCountDraft(db, { sessionId: S1, targetId: "missing", kind: "STOCK", quantity: 1, notes: "" }),
    ).rejects.toThrow(/not part of this count/);
    expect(await db.countDrafts.count()).toBe(0);
  });

  it("A13 + A14: 120 lines saved offline survive closing and reopening the app, and stay editable", async () => {
    await saveBootstrap(db, bootstrap(S1, 122));
    for (let i = 0; i < 120; i++)
      await saveCountDraft(db, { sessionId: S1, targetId: `t-${i}`, kind: "STOCK", quantity: i, notes: "" });
    const dbName = db.name;
    db.close();
    const reopened = makeFieldDB(dbName.replace("ims-field-", ""));
    await reopened.open();
    expect(await reopened.countDrafts.count()).toBe(120);
    expect(await progress(reopened, S1)).toEqual({ done: 120, total: 122 });
    await saveCountDraft(reopened, { sessionId: S1, targetId: "t-7", kind: "STOCK", quantity: 70, notes: "recount" });
    expect((await getDraft(reopened, S1, "t-7"))?.quantity).toBe(70);
    expect((await listDrafts(reopened, S1)).length).toBe(120);
    expect(await pendingCount(reopened)).toBe(120);
    reopened.close();
  });

  it("A30: if storage is full, the save fails loudly and nothing claims to be saved", async () => {
    await saveBootstrap(db, bootstrap());
    const real = db.countDrafts.put.bind(db.countDrafts);
    db.countDrafts.put = (() =>
      Promise.reject(new DOMException("Quota exceeded", "QuotaExceededError"))) as unknown as typeof db.countDrafts.put;
    const e = await saveCountDraft(db, {
      sessionId: S1,
      targetId: "t-gloves",
      kind: "STOCK",
      quantity: 5,
      notes: "",
    }).catch((x) => x);
    db.countDrafts.put = real;
    expect(e).toBeInstanceOf(FieldStorageError);
    expect(e.kind).toBe("FULL");
    expect(e.message).toMatch(/NOT saved/);
    expect(await getDraft(db, S1, "t-gloves")).toBeUndefined();
  });
});

describe("storage error classification", () => {
  it("maps browser errors to plain kinds", () => {
    expect(toStorageError(new DOMException("x", "QuotaExceededError")).kind).toBe("FULL");
    expect(
      toStorageError(
        Object.assign(new Error("wrapped"), { name: "AbortError", inner: new DOMException("x", "QuotaExceededError") }),
      ).kind,
    ).toBe("FULL");
    expect(toStorageError(Object.assign(new Error("x"), { name: "MissingAPIError" })).kind).toBe("UNAVAILABLE");
    expect(toStorageError(new DOMException("x", "InvalidStateError")).kind).toBe("UNAVAILABLE");
    expect(toStorageError(new Error("weird")).kind).toBe("UNKNOWN");
  });
});
