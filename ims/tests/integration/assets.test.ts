import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { changeAssetStatus, createAssets, getAsset, listAssets, updateAsset } from "@/lib/assets/service";
import { resolveCode } from "@/lib/inventory/lookup";
import { commitItemImport, previewItemImport } from "@/lib/inventory/import";
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
  const siteB = await makeLocation("SITE-B", "SITE");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  await prisma.unit.create({ data: { code: "pair", name: "Pair" } });
  await prisma.category.create({ data: { name: "Tools" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: whA.id }])).id))!;
  const field = (await loadAccessUser((await makeUser("FIELD", [{ id: siteB.id }])).id))!;
  const drill = await createItem(
    admin,
    { sku: "TOOL-DRILL", name: "Cordless Drill", unitId: pcs.id, trackingType: "ASSET", barcode: "4006381333931" },
    ctx(),
  );
  const gloves = await createItem(
    admin,
    { sku: "PPE-0001", name: "Safety Gloves", unitId: pcs.id, trackingType: "STOCK" },
    ctx(),
  );
  return { whA, siteB, pcs, admin, sup, field, drill, gloves };
}

describe("A02: add identical assets", () => {
  it("creates five separate tags, each with its own history", async () => {
    const w = await world();
    const r = await createAssets(
      w.sup,
      { itemId: w.drill.id, locationId: w.whA.id, quantity: 5, tagPrefix: "tool" },
      ctx(),
    );
    expect(r.assets.map((a) => a.tag)).toEqual(["TOOL-0001", "TOOL-0002", "TOOL-0003", "TOOL-0004", "TOOL-0005"]);
    const events = await prisma.assetEvent.groupBy({ by: ["assetId"], _count: true, where: { eventType: "CREATED" } });
    expect(events).toHaveLength(5);
    const more = await createAssets(
      w.sup,
      { itemId: w.drill.id, locationId: w.whA.id, quantity: 1, tagPrefix: "TOOL" },
      ctx(),
    );
    expect(more.assets[0].tag).toBe("TOOL-0006");
  });

  it("refuses stock-counted items and locations outside the user's scope", async () => {
    const w = await world();
    expect(
      await code(
        createAssets(w.sup, { itemId: w.gloves.id, locationId: w.whA.id, quantity: 1, tagPrefix: "X" }, ctx()),
      ),
    ).toBe("VALIDATION_FAILED");
    expect(
      await code(
        createAssets(w.sup, { itemId: w.drill.id, locationId: w.siteB.id, quantity: 1, tagPrefix: "X" }, ctx()),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await code(
        createAssets(w.field, { itemId: w.drill.id, locationId: w.siteB.id, quantity: 1, tagPrefix: "X" }, ctx()),
      ),
    ).toBe("FORBIDDEN");
  });

  it("flags a serial number already on another asset, without blocking", async () => {
    const w = await world();
    await createAssets(
      w.sup,
      { itemId: w.drill.id, locationId: w.whA.id, quantity: 1, tagPrefix: "TOOL", serialNumbers: ["MFG-821"] },
      ctx(),
    );
    const r = await createAssets(
      w.sup,
      {
        itemId: w.drill.id,
        locationId: w.whA.id,
        quantity: 2,
        tagPrefix: "TOOL",
        serialNumbers: ["mfg-821", "MFG-822"],
      },
      ctx(),
    );
    expect(r.assets.map((a) => a.serialNumber)).toEqual(["MFG-821", "MFG-822"]);
    expect(r.warnings).toEqual([expect.stringMatching(/MFG-821.*TOOL-0001/)]);
  });
});

describe("asset status changes (§9.4)", () => {
  it("writes an event, bumps the version, and rejects stale or disallowed changes", async () => {
    const w = await world();
    const [a] = (
      await createAssets(w.sup, { itemId: w.drill.id, locationId: w.whA.id, quantity: 1, tagPrefix: "TOOL" }, ctx())
    ).assets;
    const changed = await changeAssetStatus(
      w.sup,
      a.id,
      { status: "UNDER_MAINTENANCE", reason: "Chuck slipping", expectedVersion: 1 },
      ctx(),
    );
    expect(changed).toMatchObject({ status: "UNDER_MAINTENANCE", version: 2 });
    const ev = await prisma.assetEvent.findFirstOrThrow({ where: { assetId: a.id, eventType: "STATUS_CHANGED" } });
    expect(ev).toMatchObject({ fromStatus: "AVAILABLE", toStatus: "UNDER_MAINTENANCE", notes: "Chuck slipping" });

    expect(
      await code(changeAssetStatus(w.sup, a.id, { status: "AVAILABLE", reason: "Fixed", expectedVersion: 1 }, ctx())),
    ).toBe("CONFLICT");
    expect(
      await code(changeAssetStatus(w.sup, a.id, { status: "BORROWED", reason: "x", expectedVersion: 2 }, ctx())),
    ).toBe("CONFLICT");
    expect(
      await code(changeAssetStatus(w.field, a.id, { status: "AVAILABLE", reason: "x", expectedVersion: 2 }, ctx())),
    ).toBe("NOT_FOUND");
  });

  it("edits details with a DETAILS_CHANGED event", async () => {
    const w = await world();
    const [a] = (
      await createAssets(w.sup, { itemId: w.drill.id, locationId: w.whA.id, quantity: 1, tagPrefix: "TOOL" }, ctx())
    ).assets;
    const u = await updateAsset(w.sup, a.id, { condition: "FAIR", serialNumber: "SN-1", expectedVersion: 1 }, ctx());
    expect(u).toMatchObject({ condition: "FAIR", serialNumber: "SN-1", version: 2 });
    const d = await getAsset(w.sup, a.id);
    expect(d.events.map((e) => e.eventType)).toEqual(["DETAILS_CHANGED", "CREATED"]);
  });

  it("A23: a field user can't see another site's assets", async () => {
    const w = await world();
    const [a] = (
      await createAssets(w.sup, { itemId: w.drill.id, locationId: w.whA.id, quantity: 1, tagPrefix: "TOOL" }, ctx())
    ).assets;
    expect(await code(getAsset(w.field, a.id))).toBe("NOT_FOUND");
    expect((await listAssets(w.field, {})).rows).toHaveLength(0);
    expect((await listAssets(w.sup, { q: "tool-0001" })).rows.map((r) => r.tag)).toEqual(["TOOL-0001"]);
    // Malformed filters from a URL are ignored, not a database error.
    const all = (await listAssets(w.sup, {})).total;
    expect((await listAssets(w.sup, { status: "BOGUS", locationId: "nope", itemId: "x" })).total).toBe(all);
  });
});

describe("code lookup (scan or type)", () => {
  it("finds items by SKU, label payload, or manufacturer barcode, and assets by tag", async () => {
    const w = await world();
    const [a] = (
      await createAssets(w.sup, { itemId: w.drill.id, locationId: w.whA.id, quantity: 1, tagPrefix: "TOOL" }, ctx())
    ).assets;
    expect(await resolveCode(w.sup, " ppe-0001 ")).toMatchObject({ type: "item", id: w.gloves.id });
    expect(await resolveCode(w.sup, `ims:item:${w.gloves.id}`)).toMatchObject({ type: "item", id: w.gloves.id });
    expect(await resolveCode(w.sup, "4006381333931")).toMatchObject({ type: "item", id: w.drill.id });
    expect(await resolveCode(w.sup, "tool-0001")).toMatchObject({ type: "asset", id: a.id });
    expect(await resolveCode(w.sup, `ims:location:${w.whA.id}`)).toMatchObject({ type: "location", id: w.whA.id });
    expect(await resolveCode(w.sup, "NOPE-999")).toBeNull();
    expect(await resolveCode(w.field, "TOOL-0001")).toBeNull();
  });
});

describe("CSV item import", () => {
  const CSV = [
    "sku,name,category,unit,tracking_type,min_stock,description,barcode",
    "PPE-0002,Hard hat,Tools,pcs,STOCK,5,,",
    "ppe-0003,Ear plugs,,pair,stock,0,Foam,",
    "PPE-0001,Duplicate of existing,,pcs,STOCK,0,,",
    "PPE-0004,Bad unit,,box,STOCK,0,,",
    ",No sku,,pcs,STOCK,0,,",
    "PPE-0005,Bad min,,pcs,STOCK,-1,,",
    "PPE-0002,Same SKU twice in file,,pcs,STOCK,0,,",
    "TOOL-SAW,Circular saw,Tools,pcs,ASSET,0,,4006381333931",
  ].join("\n");

  it("previews row by row, then imports only the valid rows", async () => {
    const w = await world();
    const p = await previewItemImport(w.admin, CSV);
    expect(p.rows.map((r) => [r.line, r.ok])).toEqual([
      [2, true],
      [3, true],
      [4, false],
      [5, false],
      [6, false],
      [7, false],
      [8, false],
      [9, false],
    ]);
    expect(p.rows[2].errors.join(" ")).toMatch(/already exists/);
    expect(p.rows[3].errors.join(" ")).toMatch(/unit "box"/i);
    expect(p.rows[6].errors.join(" ")).toMatch(/line 2/);
    expect(p.rows[7].errors.join(" ")).toMatch(/barcode/i);
    expect(p.validCount).toBe(2);
    expect(await prisma.item.count()).toBe(2); // preview writes nothing

    const c = await commitItemImport(w.admin, CSV, ctx());
    expect(c.imported).toBe(2);
    expect((await prisma.item.findMany({ orderBy: { sku: "asc" } })).map((i) => i.sku)).toEqual([
      "PPE-0001",
      "PPE-0002",
      "PPE-0003",
      "TOOL-DRILL",
    ]);
    const again = await previewItemImport(w.admin, CSV);
    expect(again.validCount).toBe(0);
  });

  it("is limited to people who manage item records", async () => {
    const w = await world();
    expect(await code(previewItemImport(w.field, CSV))).toBe("FORBIDDEN");
  });

  it("rejects a file with missing columns", async () => {
    const w = await world();
    expect(await code(previewItemImport(w.admin, "sku,name\nA,B"))).toBe("VALIDATION_FAILED");
  });
});
