import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AccessUser } from "@/lib/permissions";
import { unzipXlsx } from "../xlsx-helpers";

const mocks = vi.hoisted(() => ({ query: vi.fn(), user: vi.fn(), audit: vi.fn(), extras: vi.fn() }));
vi.mock("@/lib/db/prisma", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/prisma")>();
  return {
    ...original,
    prisma: {
      item: { findMany: mocks.extras },
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
        mocks.query(original.Prisma.sql(strings, ...values)),
    },
  };
});
vi.mock("@/lib/auth/current-user", () => ({ getRequestUser: mocks.user }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.audit }));

import { GET } from "@/app/api/v1/stock/xlsx/route";
import { GET as itemsGET } from "@/app/api/v1/items/export/route";

const loc = "00000000-0000-4000-8000-000000000001";
const actor: AccessUser = {
  id: "supervisor",
  role: "SUPERVISOR",
  status: "ACTIVE",
  locations: [{ id: loc, access: "FULL" }],
};
const item = {
  id: "item",
  sku: "00123",
  name: "=SUM(1,2)",
  minStock: 10,
  isActive: true,
  photoPath: null,
  categoryName: "Tools & parts",
  unitCode: "pcs",
  onHand: 5,
  onLoan: 2,
};
const download = (query = "") => GET(new Request(`http://localhost/api/v1/stock/xlsx${query}`));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(actor);
  mocks.audit.mockResolvedValue(undefined);
  mocks.query.mockImplementation((sql) => Promise.resolve(sql.sql.startsWith("SELECT COUNT") ? [{ n: 1 }] : [item]));
  vi.stubEnv("COMPANY_NAME", "Acme & Co");
});
afterEach(() => vi.unstubAllEnvs());

describe("Stock Excel export (real route, item query, permissions and writer)", () => {
  it("links Stock filters directly to Excel and retains the existing CSV endpoint", async () => {
    const page = readFileSync(new URL("../../app/(app)/stock/page.tsx", import.meta.url), "utf8");
    expect(page).toContain('href={`/api/v1/stock/xlsx?${qs({})}`} download="ims-stock.xlsx"');
    expect(page).toContain("Export Excel");
    expect(page).not.toContain("Export CSV");
    mocks.extras.mockResolvedValue([]);
    const r = await itemsGET(new Request("http://localhost/api/v1/items/export"));
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("content-disposition")).toMatch(/ims-items-.*\.csv/);
    expect(await r.text()).toContain("'=SUM(1,2)");
  });

  it("exports formatted, safe typed data with company metadata and an audit", async () => {
    const r = await download();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.headers.get("content-disposition")).toMatch(/filename="ims-stock-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-export-total")).toBe("1");
    expect(r.headers.get("x-export-truncated")).toBe("false");
    const files = unzipXlsx(Buffer.from(await r.arrayBuffer()));
    const sheet = files["xl/worksheets/sheet1.xml"];
    for (const text of ["Acme &amp; Co", "Stock", "Exported rows: 1", "00123", "=SUM(1,2)", "Tools &amp; parts"])
      expect(sheet).toContain(text);
    expect(sheet).toContain('<c r="E8" s="5"><v>5</v></c>');
    expect(sheet).toContain('<c r="F8" s="5"><v>2</v></c>');
    expect(sheet).toContain('<c r="G8" s="5"><v>10</v></c>');
    expect(sheet).toContain('ySplit="7" topLeftCell="A8"');
    expect(sheet).toContain('autoFilter ref="A7:H8"');
    expect(sheet).toContain('mergeCell ref="A1:H1"');
    expect(sheet).toContain('<row r="1" ht="24" customHeight="1">');
    expect(sheet).toContain('<row r="2" ht="34" customHeight="1">');
    expect(sheet).toContain('<printOptions horizontalCentered="1"/>');
    expect(sheet).toContain('<row r="6" ht="8" customHeight="1"/>');
    expect(sheet).not.toContain("<f>");
    expect(files["xl/styles.xml"]).toContain('<sz val="18"/>');
    expect(files["xl/styles.xml"]).toContain('fgColor rgb="FF0B1B33"');
    expect(sheet).toContain('orientation="landscape"');
    expect(files["xl/workbook.xml"]).toContain("'Stock'!$7:$7");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "report.exported",
        recordId: "stock",
        after: { format: "xlsx", filters: {}, rows: 1, truncated: false },
      }),
    );
  });

  it("adds Items Excel metadata and text identifiers without changing the CSV layout", async () => {
    mocks.extras.mockResolvedValue([{ id: "item", description: "Details", identifiers: [{ code: "000987" }] }]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T23:30:00Z"));
    try {
      const r = await itemsGET(new Request("http://localhost/api/v1/items/export?format=xlsx"));
      expect(r.status).toBe(200);
      const files = unzipXlsx(Buffer.from(await r.arrayBuffer()));
      const sheet = files["xl/worksheets/sheet1.xml"];
      for (const text of [
        "Acme &amp; Co",
        "Items",
        "Exported: 7 Nov 2026, 7:30 AM",
        "Exported rows: 1",
        "including inactive items",
        "00123",
        "000987",
      ])
        expect(sheet).toContain(text);
      expect(sheet).toContain('<c r="A8" s="11" t="inlineStr">');
      expect(sheet).toContain('<c r="G8" s="11" t="inlineStr">');
      expect(sheet).toContain('<c r="H8" s="5"><v>5</v></c>');
      expect(sheet).toContain('autoFilter ref="A7:I8"');
      expect(sheet).toContain('ySplit="7" topLeftCell="A8"');
      expect(sheet).toContain('mergeCell ref="A1:I1"');
      expect(sheet).toContain('<row r="6" ht="8" customHeight="1"/>');
      expect(files["xl/workbook.xml"]).toContain("'Items'!$7:$7");
      expect(sheet).not.toContain("<f>");
      const csv = await itemsGET(new Request("http://localhost/api/v1/items/export"));
      expect((await csv.text()).replace(/^\uFEFF/, "").split(/\r?\n/)[0]).toBe(
        "sku,name,category,unit,min_stock,description,barcode,on_hand,active",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Stock search/category/level semantics and both location scopes, ignoring screen pagination", async () => {
    const r = await download(`?q=00123&category=${loc}&stock=low&page=99&size=1&includeInactive=true`);
    expect(r.status).toBe(200);
    const sql = mocks.query.mock.calls[0][0];
    expect(sql.sql).toContain("i.is_active");
    expect(sql.sql).toContain("x.code =");
    expect(sql.sql).toContain("i.category_id =");
    expect(sql.sql).toContain("SUM(b.quantity), 0) > 0");
    expect(sql.sql).toContain("SUM(b.quantity), 0) <= i.min_stock");
    expect(sql.sql).toContain("b.location_id = ANY");
    expect(sql.sql).toContain("bw.location_id = ANY");
    expect(sql.values.filter((v: unknown) => Array.isArray(v))).toEqual([[loc], [loc]]);
    expect(sql.values).toContain("%00123%");
    expect(sql.values).toContain("00123");
    expect(sql.values.slice(-2)).toEqual([1000, 0]);
    const sheet = unzipXlsx(Buffer.from(await r.arrayBuffer()))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("Search: 00123");
    expect(sheet).toContain(`Category ID: ${loc}`);
    expect(sheet).toContain("Stock level: Low only");
    await download("?stock=out&category=invalid");
    expect(mocks.query.mock.calls[2][0].sql).toContain("SUM(b.quantity), 0) <= 0");
    expect(mocks.query.mock.calls[2][0].sql).not.toContain("i.category_id =");
  });

  it("exports all matching pages and on-loan counts, not stock-balances report rows", async () => {
    mocks.query
      .mockResolvedValueOnce(Array.from({ length: 1000 }, () => item))
      .mockResolvedValueOnce([{ n: 1001 }])
      .mockResolvedValueOnce([{ ...item, onLoan: 3 }])
      .mockResolvedValueOnce([{ n: 1001 }]);
    const r = await download("?page=9&size=1");
    expect(mocks.query.mock.calls[2][0].values.slice(-2)).toEqual([1000, 1000]);
    const sheet = unzipXlsx(Buffer.from(await r.arrayBuffer()))["xl/worksheets/sheet1.xml"];
    expect(sheet.match(/<row /g)).toHaveLength(1008);
    expect(sheet).toContain('<c r="F1008" s="5"><v>3</v></c>');
    expect(sheet).toContain('<c r="G1008" s="5"><v>10</v></c>');
    expect(r.headers.get("x-export-total")).toBe("1001");
  });

  it("bounds the export at 50,000 and discloses truncation in workbook, headers and audit", async () => {
    mocks.query.mockImplementation((sql) =>
      Promise.resolve(sql.sql.startsWith("SELECT COUNT") ? [{ n: 50_001 }] : Array.from({ length: 1000 }, () => item)),
    );
    const r = await download();
    expect(mocks.query).toHaveBeenCalledTimes(100);
    expect(r.headers.get("x-export-truncated")).toBe("true");
    const sheet = unzipXlsx(Buffer.from(await r.arrayBuffer()))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("Exported rows: 50000");
    expect(sheet).toContain("Matching total: 50001 (truncated; export limit: 50,000 rows)");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: { format: "xlsx", filters: {}, rows: 50_000, truncated: true },
      }),
    );
  });

  it("handles empty results and global admin scope", async () => {
    mocks.user.mockResolvedValue({ ...actor, role: "ADMIN", locations: [] });
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ n: 0 }]);
    const r = await download();
    const sheet = unzipXlsx(Buffer.from(await r.arrayBuffer()))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("Exported rows: 0");
    expect(sheet).toContain('autoFilter ref="A7:H7"');
    expect(mocks.query.mock.calls[0][0].sql).not.toContain("location_id = ANY");
  });

  it("denies unauthenticated, inactive, field and view-only users before reading data", async () => {
    for (const [user, status] of [
      [null, 401],
      [{ ...actor, status: "INACTIVE" }, 401],
      [{ ...actor, role: "FIELD" }, 403],
      [{ ...actor, locations: [{ id: loc, access: "VIEW_ONLY" }] }, 403],
    ] as const) {
      mocks.user.mockResolvedValue(user);
      expect((await download()).status).toBe(status);
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
