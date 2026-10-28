import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { receiveStock } from "@/lib/inventory/stock";
import { createAssets, changeAssetStatus } from "@/lib/assets/service";
import {
  bootstrapSession,
  closeCountSession,
  createCountSession,
  listCountSessions,
  listMyAssignments,
} from "@/lib/counts/service";
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
  const wh = await makeLocation("WH-A");
  const site = await makeLocation("SITE-B", "SITE");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;
  const fieldRow = await makeUser("FIELD", [{ id: wh.id }]);
  const field = (await loadAccessUser(fieldRow.id))!;
  const otherField = (await loadAccessUser((await makeUser("FIELD", [{ id: site.id }])).id))!;
  const viewOnly = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id, access: "VIEW_ONLY" }])).id))!;
  const gloves = await createItem(
    admin,
    { sku: "PPE-0001", name: "Safety Gloves", unitId: pcs.id, trackingType: "STOCK", barcode: "036000291452" },
    ctx(),
  );
  const ties = await createItem(
    admin,
    { sku: "ELC-0042", name: "Cable ties", unitId: pcs.id, trackingType: "STOCK" },
    ctx(),
  );
  const masks = await createItem(
    admin,
    { sku: "PPE-0009", name: "Masks", unitId: pcs.id, trackingType: "STOCK" },
    ctx(),
  );
  const drill = await createItem(
    admin,
    { sku: "TOOL-DRILL", name: "Drill", unitId: pcs.id, trackingType: "ASSET" },
    ctx(),
  );
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
  await receiveStock(admin, { locationId: site.id, lines: [{ itemId: masks.id, quantity: 9 }] }, ctx(), randomUUID());
  const { assets } = await createAssets(
    admin,
    { itemId: drill.id, locationId: wh.id, quantity: 3, tagPrefix: "TOOL", serialNumbers: ["SN-1"] },
    ctx(),
  );
  await changeAssetStatus(
    admin,
    assets[2].id,
    { status: "RETIRED", reason: "Broken beyond repair", expectedVersion: 1 },
    ctx(),
  );
  return { wh, site, admin, sup, field, otherField, viewOnly, gloves, ties, masks, drill, assets };
}

describe("count session creation", () => {
  it("snapshots stock and assets at the location and assigns counters", async () => {
    const w = await world();
    const s = await createCountSession(
      w.sup,
      { name: "Q4 count", locationId: w.wh.id, assigneeIds: [w.field.id], includeStock: true, includeAssets: true },
      ctx(),
    );
    expect(s.reference).toMatch(/^CNT-\d{4}-000001$/);
    const targets = await prisma.countSessionItem.findMany({
      where: { sessionId: s.id },
      include: { item: true, asset: true },
    });
    const stock = targets.filter((t) => t.kind === "STOCK").map((t) => [t.item.sku, t.expectedQuantity]);
    expect(stock.sort()).toEqual([
      ["ELC-0042", 40],
      ["PPE-0001", 120],
    ]);
    const assets = targets.filter((t) => t.kind === "ASSET").map((t) => t.asset!.tag);
    expect(assets.sort()).toEqual(["TOOL-0001", "TOOL-0002"]); // retired TOOL-0003 left out
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: "count.created" } });
    expect(audit.recordId).toBe(s.id);
  });

  it("only lets supervisors/admins create, and only at their locations", async () => {
    const w = await world();
    const base = { name: "X", assigneeIds: [] as string[], includeStock: true, includeAssets: false };
    expect(await code(createCountSession(w.field, { ...base, locationId: w.wh.id }, ctx()))).toBe("FORBIDDEN");
    expect(await code(createCountSession(w.sup, { ...base, locationId: w.site.id }, ctx()))).toBe("FORBIDDEN");
  });

  it("rejects counters who can't count at that location", async () => {
    const w = await world();
    const go = (ids: string[]) =>
      createCountSession(
        w.sup,
        { name: "X", locationId: w.wh.id, assigneeIds: ids, includeStock: true, includeAssets: true },
        ctx(),
      );
    expect(await code(go([w.otherField.id]))).toBe("VALIDATION_FAILED");
    expect(await code(go([w.viewOnly.id]))).toBe("VALIDATION_FAILED");
    expect(await code(go([randomUUID()]))).toBe("VALIDATION_FAILED");
  });

  it("can be limited to chosen categories", async () => {
    const w = await world();
    const ppe = await prisma.category.create({ data: { name: "PPE" } });
    await prisma.item.update({ where: { id: w.gloves.id }, data: { categoryId: ppe.id } });
    await prisma.item.update({ where: { id: w.drill.id }, data: { categoryId: ppe.id } });
    const s = await createCountSession(
      w.sup,
      {
        name: "PPE only",
        locationId: w.wh.id,
        assigneeIds: [],
        includeStock: true,
        includeAssets: true,
        categoryIds: [ppe.id],
      },
      ctx(),
    );
    const t = await prisma.countSessionItem.findMany({ where: { sessionId: s.id }, include: { item: true } });
    expect(t.map((x) => x.item.sku).sort()).toEqual(["PPE-0001", "TOOL-DRILL", "TOOL-DRILL"]);
  });

  it("refuses an empty scope", async () => {
    const w = await world();
    const e = await createCountSession(
      w.admin,
      { name: "X", locationId: w.site.id, assigneeIds: [], includeStock: false, includeAssets: true },
      ctx(),
    ).catch((x) => x);
    expect(e.code).toBe("VALIDATION_FAILED");
    expect(e.message).toMatch(/nothing to count/i);
  });
});

describe("my assignments and bootstrap (§11.3)", () => {
  it("lists only open sessions assigned to me", async () => {
    const w = await world();
    const mine = await createCountSession(
      w.sup,
      { name: "Mine", locationId: w.wh.id, assigneeIds: [w.field.id], includeStock: true, includeAssets: true },
      ctx(),
    );
    await createCountSession(
      w.sup,
      { name: "Not mine", locationId: w.wh.id, assigneeIds: [], includeStock: true, includeAssets: false },
      ctx(),
    );
    const list = await listMyAssignments(w.field);
    expect(list.map((a) => [a.name, a.targetCount, a.location.code])).toEqual([["Mine", 4, "WH-A"]]);
    expect(await listMyAssignments(w.otherField)).toEqual([]);
    await closeCountSession(w.sup, mine.id, ctx());
    expect(await listMyAssignments(w.field)).toEqual([]);
    expect((await listCountSessions(w.sup, {})).rows.map((r) => r.status).sort()).toEqual(["CLOSED", "OPEN"]);
  });

  it("returns only safe fields: no expected quantities, no other people", async () => {
    const w = await world();
    const s = await createCountSession(
      w.sup,
      { name: "Q4", locationId: w.wh.id, assigneeIds: [w.field.id], includeStock: true, includeAssets: true },
      ctx(),
    );
    const b = await bootstrapSession(w.field, s.id);
    expect(b.session).toMatchObject({
      id: s.id,
      name: "Q4",
      reference: s.reference,
      location: { code: "WH-A" },
      version: 1,
    });
    expect(b.targets).toHaveLength(4);
    const text = JSON.stringify(b);
    expect(text).not.toMatch(/expected|passwordHash|email/i);
    expect(text).not.toContain("120");
    const gloves = b.targets.find((t) => t.item.sku === "PPE-0001")!;
    expect(gloves).toMatchObject({ kind: "STOCK", version: 1, item: { name: "Safety Gloves", unit: "pcs" } });
    const codes = b.identifiers
      .filter((i) => i.targetId === gloves.id)
      .map((i) => i.code)
      .sort();
    expect(codes).toEqual(["036000291452", "PPE-0001", `ims:item:${w.gloves.id}`].sort());
    const drill = b.targets.find((t) => t.asset?.tag === "TOOL-0001")!;
    expect(drill.asset).toMatchObject({ serialNumber: "SN-1", status: "AVAILABLE", condition: "GOOD" });
    expect(b.identifiers.some((i) => i.code === "TOOL-0001" && i.targetId === drill.id)).toBe(true);
    expect(Date.parse(b.serverTime)).toBeGreaterThan(0);
  });

  it("hides sessions from people who aren't assigned, and refuses closed ones", async () => {
    const w = await world();
    const s = await createCountSession(
      w.sup,
      { name: "Q4", locationId: w.wh.id, assigneeIds: [w.field.id], includeStock: true, includeAssets: false },
      ctx(),
    );
    expect(await code(bootstrapSession(w.otherField, s.id))).toBe("NOT_FOUND");
    // Same location, full access, but not assigned to this count.
    const colleague = (await loadAccessUser((await makeUser("FIELD", [{ id: w.wh.id }])).id))!;
    expect(await code(bootstrapSession(colleague, s.id))).toBe("NOT_FOUND");
    expect(await code(bootstrapSession(w.viewOnly, s.id))).toBe("NOT_FOUND");
    expect(await code(bootstrapSession(w.field, randomUUID()))).toBe("NOT_FOUND");
    await closeCountSession(w.sup, s.id, ctx());
    expect(await code(bootstrapSession(w.field, s.id))).toBe("CONFLICT");
  });

  it("stops serving a session once the counter loses access to the location", async () => {
    const w = await world();
    const s = await createCountSession(
      w.sup,
      { name: "Q4", locationId: w.wh.id, assigneeIds: [w.field.id], includeStock: true, includeAssets: false },
      ctx(),
    );
    // Moved to another site: the session is hidden.
    await prisma.userLocation.updateMany({ where: { userId: w.field.id }, data: { locationId: w.site.id } });
    const moved = (await loadAccessUser(w.field.id))!;
    expect(await listMyAssignments(moved)).toEqual([]);
    expect(await code(bootstrapSession(moved, s.id))).toBe("NOT_FOUND");
    // No locations left at all: an empty list, not an error.
    await prisma.userLocation.deleteMany({ where: { userId: w.field.id } });
    expect(await listMyAssignments((await loadAccessUser(w.field.id))!)).toEqual([]);
  });
});
