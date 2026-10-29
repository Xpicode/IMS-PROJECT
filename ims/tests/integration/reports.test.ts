import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { loadAccessUser } from "@/lib/users/access";
import { createSession } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { createItem } from "@/lib/inventory/items";
import { issueStock, receiveStock, transferStock } from "@/lib/inventory/stock";
import { createAssets } from "@/lib/assets/service";
import { releaseBorrowing } from "@/lib/borrowing/service";
import { createCountSession } from "@/lib/counts/service";
import { pushOperations } from "@/lib/counts/sync";
import { approveLine } from "@/lib/counts/review";
import { runReport } from "@/lib/reports/service";
import * as csvRoute from "@/app/api/v1/reports/[name]/csv/route";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function world() {
  const wh = await makeLocation("WH-A");
  const site = await makeLocation("SITE-B", "SITE");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;
  const siteSup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: site.id }])).id))!;
  const field = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id))!;
  const gloves = await createItem(
    admin,
    { sku: "PPE-1", name: "=Gloves", unitId: pcs.id, trackingType: "STOCK", minStock: 50 },
    ctx(),
  );
  const ties = await createItem(
    admin,
    { sku: "ELC-1", name: "Cable ties", unitId: pcs.id, trackingType: "STOCK" },
    ctx(),
  );
  const drill = await createItem(admin, { sku: "TOOL-D", name: "Drill", unitId: pcs.id, trackingType: "ASSET" }, ctx());
  await receiveStock(
    admin,
    {
      locationId: wh.id,
      lines: [
        { itemId: gloves.id, quantity: 60 },
        { itemId: ties.id, quantity: 10 },
      ],
    },
    ctx(),
    randomUUID(),
  );
  await receiveStock(admin, { locationId: site.id, lines: [{ itemId: ties.id, quantity: 7 }] }, ctx(), randomUUID());
  await issueStock(
    sup,
    { locationId: wh.id, lines: [{ itemId: gloves.id, quantity: 15 }], recipientName: "Pedro", purpose: "WO-1" },
    ctx(),
    randomUUID(),
  );
  await transferStock(
    admin,
    { fromLocationId: wh.id, toLocationId: site.id, lines: [{ itemId: ties.id, quantity: 4 }] },
    ctx(),
    randomUUID(),
  );
  const { assets } = await createAssets(
    admin,
    { itemId: drill.id, locationId: wh.id, quantity: 2, tagPrefix: "TOOL" },
    ctx(),
  );
  await releaseBorrowing(
    sup,
    {
      locationId: wh.id,
      borrowerName: "José Peña",
      purpose: "Job",
      dueAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
      lines: [{ assetId: assets[0].id, condition: "GOOD" }],
    },
    ctx(),
    randomUUID(),
  );
  return { wh, site, admin, sup, siteSup, field, gloves, ties, assets };
}
type W = Awaited<ReturnType<typeof world>>;

describe("reports (§9.5)", () => {
  it("stock balances: per item and location, low/out flags, limited to my locations", async () => {
    const w = await world();
    const all = await runReport(w.admin, "stock-balances", {});
    const row = (sku: string, loc: string) => all.rows.find((r) => r.sku === sku && r.location === loc);
    expect(row("PPE-1", "WH-A")).toMatchObject({ onHand: 45, minStock: 50, status: "Low" });
    expect(row("ELC-1", "SITE-B")).toMatchObject({ onHand: 11 });
    const mine = await runReport(w.sup, "stock-balances", {});
    expect(new Set(mine.rows.map((r) => r.location))).toEqual(new Set(["WH-A"]));
    expect((await runReport(w.admin, "stock-balances", { stock: "low" })).rows.map((r) => r.sku)).toEqual(["PPE-1"]);
    expect((await runReport(w.admin, "stock-balances", { q: "cable" })).rows.every((r) => r.sku === "ELC-1")).toBe(
      true,
    );
  });

  it("movement ledger: signed quantities, balance after, filters by type, reference, item and date", async () => {
    const w = await world();
    const r = await runReport(w.admin, "movements", { locationId: w.wh.id });
    const iss = r.rows.find((x) => x.type === "Issue")!;
    expect(iss).toMatchObject({
      sku: "PPE-1",
      location: "WH-A",
      quantity: -15,
      balanceAfter: 45,
      user: expect.any(String),
      party: "Pedro · WO-1",
    });
    expect(
      (await runReport(w.admin, "movements", { type: "TRANSFER" })).rows.map((x) => [x.location, x.quantity]).sort(),
    ).toEqual([
      ["SITE-B", 4],
      ["WH-A", -4],
    ]);
    expect((await runReport(w.admin, "movements", { reference: String(iss.reference) })).rows).toHaveLength(1);
    expect((await runReport(w.admin, "movements", { itemId: w.gloves.id })).rows).toHaveLength(2);
    expect((await runReport(w.admin, "movements", { to: "2000-01-01" })).rows).toHaveLength(0);
    // Totals tie back to balances: the ledger is the proof.
    const sum = (await runReport(w.admin, "movements", { itemId: w.ties.id, locationId: w.site.id })).rows.reduce(
      (s, x) => s + Number(x.quantity),
      0,
    );
    expect(sum).toBe(11);
    expect((await runReport(w.siteSup, "movements", {})).rows.every((x) => x.location === "SITE-B")).toBe(true);
  });

  it("asset custody and overdue loans", async () => {
    const w = await world();
    const a = await runReport(w.sup, "assets", {});
    expect(a.rows.map((r) => [r.tag, r.status, r.custodian ?? null, r.loan ?? null])).toEqual([
      ["TOOL-0001", "Borrowed", "José Peña", expect.stringMatching(/^BOR-/)],
      ["TOOL-0002", "Available", null, null],
    ]);
    expect((await runReport(w.sup, "assets", { status: "AVAILABLE" })).rows.map((r) => r.tag)).toEqual(["TOOL-0002"]);
    // A loan that isn't due yet must not be listed.
    await releaseBorrowing(
      w.sup,
      {
        locationId: w.wh.id,
        borrowerName: "Ana",
        purpose: "Job 2",
        dueAt: new Date(Date.now() + 86400_000).toISOString(),
        lines: [{ assetId: w.assets[1].id, condition: "GOOD" }],
      },
      ctx(),
      randomUUID(),
    );
    const o = await runReport(w.sup, "overdue", {});
    expect(o.rows).toEqual([
      expect.objectContaining({ borrower: "José Peña", assets: "TOOL-0001", daysOverdue: 3, location: "WH-A" }),
    ]);
    expect((await runReport(w.siteSup, "overdue", {})).rows).toHaveLength(0);
  });

  it("count discrepancies: expected, counted, difference, decision and adjustment", async () => {
    const w = await world();
    const s = await createCountSession(
      w.sup,
      { name: "Q4", locationId: w.wh.id, assigneeIds: [w.field.id], includeStock: true, includeAssets: false },
      ctx(),
    );
    const t = await prisma.countSessionItem.findFirstOrThrow({ where: { sessionId: s.id, item: { sku: "PPE-1" } } });
    await pushOperations(
      w.field,
      {
        deviceId: "d",
        operations: [
          {
            operationId: randomUUID(),
            type: "SUBMIT_COUNT",
            sessionId: s.id,
            targetId: t.id,
            baseVersion: 1,
            clientRecordedAt: new Date().toISOString(),
            payload: { quantity: 41 },
          },
        ],
      },
      ctx(),
    );
    await approveLine(w.sup, s.id, t.id, {}, ctx(), randomUUID());
    const r = await runReport(w.sup, "count-discrepancies", {});
    expect(r.rows).toEqual([
      expect.objectContaining({
        count: s.reference,
        sku: "PPE-1",
        expected: 45,
        counted: 41,
        difference: -4,
        decision: "Approved",
        adjustment: expect.stringMatching(/^ADJ-/),
      }),
    ]);
    expect((await runReport(w.siteSup, "count-discrepancies", {})).rows).toHaveLength(0);
  });

  it("is refused to field staff, and checks the location filter against my access", async () => {
    const w = await world();
    await expect(runReport(w.field, "movements", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(runReport(w.sup, "movements", { locationId: w.site.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(runReport(w.sup, "nope" as never, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("CSV download", () => {
  const BASE = "http://localhost:3000";
  const get = async (w: W, who: "sup" | "siteSup" | "admin", name: string, q = "") => {
    const tok = await createSession(w[who].id);
    return csvRoute.GET(
      new Request(`${BASE}/api/v1/reports/${name}/csv${q}`, { headers: { cookie: `${SESSION_COOKIE}=${tok}` } }),
      {
        params: Promise.resolve({ name }),
      },
    );
  };

  it("downloads a safe CSV (formulas defused, accents kept) and audits it", async () => {
    const w = await world();
    const r = await get(w, "sup", "stock-balances");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("content-disposition")).toMatch(
      /^attachment; filename="stock-balances-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(r.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM, so Excel reads accents
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain(`"'=Gloves"`);
    expect(text).not.toMatch(/(^|,)"=/m);
    expect(text).not.toContain("SITE-B");
    const assets = new TextDecoder().decode(await (await get(w, "sup", "assets")).arrayBuffer());
    expect(assets).toContain("José Peña");
    expect(await prisma.auditEvent.count({ where: { eventType: "report.exported" } })).toBe(2);
  });

  it("refuses unknown reports and other people's locations", async () => {
    const w = await world();
    expect((await get(w, "sup", "../../etc/passwd")).status).toBe(404);
    expect((await get(w, "sup", "movements", `?locationId=${w.site.id}`)).status).toBe(403);
  });
});
