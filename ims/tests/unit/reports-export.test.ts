import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "@/lib/permissions";
import { unzipXlsx } from "../xlsx-helpers";

const mocks = vi.hoisted(() => {
  const model = () => ({ findMany: vi.fn(), count: vi.fn() });
  return {
    db: {
      stockBalance: model(),
      stockMovement: model(),
      borrowingLine: model(),
      borrowing: model(),
      countReview: model(),
      location: { findFirst: vi.fn() },
      user: { findFirst: vi.fn() },
    },
    user: vi.fn(),
    audit: vi.fn(),
  };
});
vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.db, Prisma: {} }));
vi.mock("@/lib/auth/current-user", () => ({ getRequestUser: mocks.user }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.audit }));

import { GET } from "@/app/api/v1/reports/[name]/xlsx/route";
import { GET as csvGET } from "@/app/api/v1/reports/[name]/csv/route";
import { REPORTS, runReport, type ReportName } from "@/lib/reports/service";

const loc = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const actor: AccessUser = {
  id: "supervisor",
  role: "SUPERVISOR",
  status: "ACTIVE",
  locations: [{ id: loc, access: "VIEW_ONLY" }],
};
const date = new Date("2026-11-05T16:30:00Z");
const item = { sku: "00123", name: "=Gloves & José", minStock: 50, unit: { code: "pcs" }, category: null };
const fixtures = {
  "stock-balances": { item, location: { code: "WH-A" }, quantity: 45 },
  movements: {
    item,
    location: { code: "WH-A" },
    quantity: -15,
    balanceAfter: 45,
    transaction: {
      reference: "ISS-001",
      type: "ISSUE",
      confirmedAt: date,
      recipientName: "Pedro",
      reason: "Job",
      actor: { name: "José" },
    },
  },
  loans: {
    item,
    quantity: 3,
    returnedQuantity: 1,
    borrowing: {
      reference: "BOR-001",
      borrowerName: "José",
      borrowerDept: null,
      dueAt: date,
      location: { code: "WH-A" },
    },
  },
  overdue: {
    reference: "BOR-001",
    borrowerName: "José",
    borrowerDept: null,
    lines: [{ quantity: 2, returnedQuantity: 0, item: { name: "Drill" } }],
    dueAt: date,
    location: { code: "WH-A" },
    purpose: "+Job",
  },
  "count-discrepancies": {
    target: { item, session: { reference: "CNT-001", location: { code: "WH-A" } } },
    entry: null,
    adjustment: { reference: "ADJ-001" },
    reviewer: { name: "José" },
    decidedAt: date,
    expectedQuantity: 45,
    countedQuantity: 41,
    variance: -4,
    decision: "APPROVED",
  },
};
const models = {
  "stock-balances": mocks.db.stockBalance,
  movements: mocks.db.stockMovement,
  loans: mocks.db.borrowingLine,
  overdue: mocks.db.borrowing,
  "count-discrepancies": mocks.db.countReview,
};
const download = (name: string, query = "", csv = false) =>
  (csv ? csvGET : GET)(new Request(`http://localhost/api/v1/reports/${name}/${csv ? "csv" : "xlsx"}${query}`), {
    params: Promise.resolve({ name }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(actor);
  mocks.audit.mockResolvedValue(undefined);
  mocks.db.location.findFirst.mockResolvedValue({ code: "WH-A", name: "Warehouse A" });
  mocks.db.user.findFirst.mockResolvedValue({ name: "José" });
  vi.stubEnv("COMPANY_NAME", 'Acme, "Tools" & Co');
  for (const name of Object.keys(REPORTS) as ReportName[]) {
    models[name].findMany.mockResolvedValue([fixtures[name]]);
    models[name].count.mockResolvedValue(1);
  }
});
afterEach(() => vi.unstubAllEnvs());

describe("formatted report downloads (real route, service, permissions and XLSX writer; mocked DB)", () => {
  it.each(Object.keys(REPORTS) as ReportName[])(
    "exports %s with all columns, scoped queries, styles and audit",
    async (name) => {
      const r = await download(name, "?page=99&size=1");
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(r.headers.get("content-disposition")).toMatch(
        new RegExp(`filename="${name}-\\d{4}-\\d{2}-\\d{2}\\.xlsx"`),
      );
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("x-export-total")).toBe("1");
      const files = unzipXlsx(Buffer.from(await r.arrayBuffer()));
      const sheet = files["xl/worksheets/sheet1.xml"];
      expect(Object.keys(files)).toHaveLength(6);
      expect(sheet).toContain('state="frozen"');
      expect(sheet).toContain('customWidth="1"');
      expect(sheet).toMatch(/r="A7" s="[12]"/);
      expect(files["xl/styles.xml"]).toContain('fgColor rgb="FF0B1B33"');
      expect(sheet).toContain('orientation="landscape"');
      expect(files["xl/workbook.xml"]).toContain("!$7:$7");
      expect(sheet.match(/<row /g)).toHaveLength(8);
      expect(sheet).toContain('<row r="6" ht="8" customHeight="1"/>');
      expect(sheet).toContain('<row r="2" ht="34" customHeight="1">');
      expect(sheet).toContain('<printOptions horizontalCentered="1"/>');
      expect(sheet).toContain('ySplit="7" topLeftCell="A8"');
      expect(sheet).toContain('Acme, "Tools" &amp; Co');
      expect(sheet).toContain(REPORTS[name].title.replaceAll("&", "&amp;"));
      expect(sheet).toContain("Active filters: None (all my locations)");
      expect(sheet).toContain("Exported rows: 1");
      expect(sheet).not.toContain("<f>");
      const report = await runReport(actor, name, {}, { excel: true });
      for (const c of report.columns) expect(sheet).toContain(`>${c.label.replaceAll("&", "&amp;")}<`);
      expect(models[name].findMany.mock.calls[0][0].take).toBe(name === "stock-balances" ? 100_000 : 50_000);
      const where = models[name].findMany.mock.calls[0][0].where;
      expect(
        name === "count-discrepancies"
          ? where.target.session.locationId
          : name === "loans"
            ? where.borrowing.locationId
            : where.locationId,
      ).toEqual({ in: [loc] });
      expect(mocks.audit).toHaveBeenCalledWith(
        mocks.db,
        expect.objectContaining({
          eventType: "report.exported",
          recordId: name,
          after: { format: "xlsx", filters: {}, rows: 1, truncated: false },
        }),
      );
      if (name === "stock-balances") {
        expect(sheet).toContain(">00123</t>");
        expect(sheet).toContain(">=Gloves &amp; José</t>");
        expect(sheet).toContain('<c r="E8" s="5"><v>45</v></c>');
      }
      if (name === "movements") {
        expect(sheet).toContain('<c r="G8" s="6"><v>-15</v></c>');
        expect(sheet).toContain('<c r="A8" s="8"><v>46332.020833333336</v></c>');
      }
      if (name === "loans") {
        expect(sheet).toContain(">00123</t>");
        expect(sheet).toContain('<c r="F8" s="5"><v>2</v></c>');
        expect(sheet).toContain('<c r="H8" s="7"><v>46332</v></c>');
      }
      if (name === "count-discrepancies") expect(sheet).toContain('<c r="H8" s="5"><v>-4</v></c>');
    },
  );

  it("preserves every supported filter, including company-local date boundaries", async () => {
    const query = `?locationId=${loc}&itemId=${other}&userId=${other}&type=ISSUE&reference=ISS-001&q=Gloves&from=2026-11-06&to=2026-11-06&page=2`;
    expect((await download("movements", query)).status).toBe(200);
    expect(mocks.db.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          locationId: { in: [loc] },
          itemId: other,
          transaction: {
            type: "ISSUE",
            actorId: other,
            reference: expect.anything(),
            confirmedAt: { gte: new Date("2026-11-05T16:00Z"), lte: new Date("2026-11-06T15:59:59.999Z") },
          },
          item: { OR: expect.any(Array) },
        },
      }),
    );
    await download("loans", `?q=José&itemId=${other}`);
    expect(mocks.db.borrowingLine.findMany.mock.calls[0][0].where).toMatchObject({
      status: "OUT",
      itemId: other,
      borrowing: { status: "OPEN", OR: expect.any(Array) },
    });
    await download("overdue", "?q=José");
    expect(mocks.db.borrowing.findMany.mock.calls[0][0].where).toMatchObject({
      status: "OPEN",
      dueAt: { lt: expect.any(Date) },
      OR: expect.any(Array),
    });
    await download("count-discrepancies", `?reference=CNT-001&itemId=${other}&to=2026-11-06`);
    expect(mocks.db.countReview.findMany.mock.calls[0][0].where).toMatchObject({
      target: { session: { reference: expect.anything() }, itemId: other },
      decidedAt: { lte: new Date("2026-11-06T15:59:59.999Z") },
    });
    await download("stock-balances", "?stock=out&q=Gloves");
    expect(mocks.db.stockBalance.findMany.mock.calls[0][0].where).toMatchObject({
      quantity: 0,
      item: { OR: expect.any(Array) },
    });
    const low = await download("stock-balances", "?stock=low");
    expect(low.headers.get("x-export-total")).toBe("1");
  });

  it("exports beyond the screen page and reconciles signed movement totals", async () => {
    mocks.db.stockMovement.findMany.mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => ({ ...fixtures.movements, quantity: i === 100 ? -15 : 1 })),
    );
    mocks.db.stockMovement.count.mockResolvedValue(101);
    const r = await download("movements", "?page=2&size=10");
    const sheet = unzipXlsx(Buffer.from(await r.arrayBuffer()))["xl/worksheets/sheet1.xml"];
    expect(sheet.match(/<row /g)).toHaveLength(108);
    expect(
      [...sheet.matchAll(/<c r="G\d+" s="(?:6|15)"><v>(-?\d+)<\/v>/g)].reduce((sum, m) => sum + Number(m[1]), 0),
    ).toBe(85);
    expect(r.headers.get("x-export-total")).toBe("101");
    expect(r.headers.get("x-export-truncated")).toBe("false");
  });

  it("reports the bound and produces a valid header-only workbook for empty results", async () => {
    mocks.db.borrowingLine.count.mockResolvedValue(50_001);
    expect((await download("loans")).headers.get("x-export-truncated")).toBe("true");
    mocks.db.borrowingLine.count.mockResolvedValue(0);
    mocks.db.borrowingLine.findMany.mockResolvedValue([]);
    const r = await download("loans");
    expect(unzipXlsx(Buffer.from(await r.arrayBuffer()))["xl/worksheets/sheet1.xml"].match(/<row /g)).toHaveLength(7);
  });

  it.each(Object.keys(REPORTS) as ReportName[])(
    "enforces auth, roles and location access for %s before querying",
    async (name) => {
      mocks.user.mockResolvedValue(null);
      expect((await download(name)).status).toBe(401);
      mocks.user.mockResolvedValue({ ...actor, role: "FIELD" });
      expect((await download(name)).status).toBe(403);
      mocks.user.mockResolvedValue({ ...actor, status: "INACTIVE" });
      expect((await download(name)).status).toBe(401);
      mocks.user.mockResolvedValue(actor);
      expect((await download(name, `?locationId=${other}`)).status).toBe(403);
      expect((await download(name, `?locationId=${other}`, true)).status).toBe(403);
      expect(mocks.db.location.findFirst).not.toHaveBeenCalled();
      expect(mocks.db.user.findFirst).not.toHaveBeenCalled();
      expect(models[name].findMany).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown reports, supports global admins, and leaves CSV dates and guards intact", async () => {
    expect((await download("unknown")).status).toBe(404);
    mocks.user.mockResolvedValue({ ...actor, role: "ADMIN", locations: [] });
    await download("movements");
    expect(mocks.db.stockMovement.findMany.mock.calls[0][0].where.locationId).toBeUndefined();
    const csv = await download("movements", "", true);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const text = await csv.text();
    expect(text).toContain("6 Nov 2026, 12:30 AM");
    expect(text).toContain("'=Gloves & José");
    expect(text).toContain(",-15,45,");
  });

  it.each([false, true])(
    "includes safe metadata, active display labels and bounded/empty counts (CSV: %s)",
    async (csv) => {
      vi.useFakeTimers();
      vi.setSystemTime(date);
      vi.stubEnv("COMPANY_NAME", '=Acme, "Tools"\n& Co');
      try {
        mocks.db.stockMovement.count.mockResolvedValue(50_001);
        const query = `?locationId=${loc}&userId=${other}&type=ADJUSTMENT&from=2026-11-06&q=${encodeURIComponent('=SUM(1,2)\n"x"')}&status=LOST&page=2`;
        const r = await download("movements", query, csv);
        expect(r.headers.get("x-export-truncated")).toBe("true");
        const bytes = Buffer.from(await r.arrayBuffer());
        const text = csv ? bytes.toString("utf8") : unzipXlsx(bytes)["xl/worksheets/sheet1.xml"];
        for (const value of [
          "Movement ledger",
          "6 Nov 2026, 12:30 AM",
          "Location: WH-A · Warehouse A",
          "By: José",
          "Type: Count adjustment",
          "From date: 6 Nov 2026",
          "Exported rows: 1",
          "Matching total: 50001 (truncated; export limit: 50,000 rows)",
        ])
          expect(text).toContain(value);
        expect(text).not.toContain("Status: Lost");
        expect(text).not.toContain("page=2");
        if (csv) {
          expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
          expect(text).toContain('"\'=Acme, ""Tools""\n& Co"\r\n');
          expect(text).toContain('Item: =SUM(1,2)\n""x""');
          expect(text).toContain('\r\n\r\n"Date","Reference"');
        } else {
          expect(text).toContain('=Acme, "Tools"\n&amp; Co');
          expect(text).not.toContain("<f>");
          expect(text).toContain('autoFilter ref="A8:K9"');
          expect(text).toContain('ySplit="8" topLeftCell="A9"');
        }
        expect(mocks.db.user.findFirst.mock.calls[0][0].where.stockTxns.some.movements.some.locationId).toEqual({
          in: [loc],
        });
        mocks.db.stockMovement.count.mockResolvedValue(0);
        mocks.db.stockMovement.findMany.mockResolvedValue([]);
        const empty = await download("movements", "?type=invalid&q=", csv);
        const emptyBytes = Buffer.from(await empty.arrayBuffer());
        const emptyText = csv ? emptyBytes.toString("utf8") : unzipXlsx(emptyBytes)["xl/worksheets/sheet1.xml"];
        expect(emptyText).toContain("Exported rows: 0");
        expect(emptyText).toContain("Active filters: None (all my locations)");
        expect(emptyText).not.toContain("Matching total:");
        if (!csv) expect(emptyText).toContain('autoFilter ref="A7:K7"');
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
