import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { toXlsx } from "@/lib/xlsx";
import { parseItemWorkbook, MAX_EXPANDED_BYTES } from "@/lib/inventory/import-file";
import { unzipXlsx } from "../xlsx-helpers";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  units: vi.fn(),
  categories: vi.fn(),
  items: vi.fn(),
  codes: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getRequestUser: mocks.user }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.audit }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    unit: { findMany: mocks.units },
    category: { findMany: mocks.categories },
    item: { findMany: mocks.items },
    itemIdentifier: { findMany: mocks.codes },
    $transaction: mocks.transaction,
  },
}));
import { GET, POST } from "@/app/api/v1/items/import/route";

const columns = ["sku", "name", "category", "unit", "tracking_type", "min_stock", "description", "barcode"];
const workbook = () => toXlsx("Items", columns, [["00123", "Goggles", "", "pcs", "STOCK", 2, "", "000987"]]);
const rezip = (files: Record<string, string>) =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))));
const upload = (buffer: Buffer, mode = "preview", name = "items.xlsx") => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buffer)], name));
  form.set("mode", mode);
  return POST(new Request("http://localhost/api/v1/items/import", { method: "POST", body: form }));
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "admin", role: "ADMIN", status: "ACTIVE", locations: [] });
  mocks.units.mockResolvedValue([{ id: "00000000-0000-4000-8000-000000000001", code: "pcs" }]);
  mocks.categories.mockResolvedValue([]);
  mocks.items.mockResolvedValue([]);
  mocks.codes.mockResolvedValue([]);
  mocks.audit.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation((fn) => fn({ item: { create: mocks.create } }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Item Excel import", () => {
  it("downloads a styled metadata template and roundtrips preview/commit with worksheet row numbers", async () => {
    vi.stubEnv("COMPANY_NAME", "Acme & Co");
    vi.stubEnv("NEXT_PUBLIC_COMPANY_TIMEZONE", "Asia/Manila");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T23:30:00Z"));
    mocks.categories.mockResolvedValue([
      { id: "ppe", name: "PPE" },
      { id: "tools", name: "Tools" },
    ]);
    const response = await GET(new Request("http://localhost/api/v1/items/import"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("ims-items-template.xlsx");
    const buffer = Buffer.from(await response.arrayBuffer());
    const { rows, headerRow } = await parseItemWorkbook(buffer);
    expect(headerRow).toBe(6);
    expect(rows[0]).toEqual(columns);
    expect(rows[1][7]).toBe("001234567890");
    const files = unzipXlsx(buffer);
    expect(files["xl/worksheets/sheet1.xml"]).toContain('<row r="6" ht="30" customHeight="1">');
    expect(files["xl/worksheets/sheet1.xml"]).toContain('customWidth="1" style="11"');
    expect(files["xl/styles.xml"]).toContain('numFmtId="49"');
    const sheet = files["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("Acme &amp; Co");
    expect(sheet).toContain("Item Import Template");
    expect(sheet).toContain("Generated: 7 Nov 2026, 7:30 AM (Asia/Manila)");
    expect(sheet).toContain('mergeCell ref="A1:H1"');
    expect(sheet).toContain('<row r="1" ht="24" customHeight="1">');
    expect(sheet).toContain('<row r="2" ht="34" customHeight="1">');
    expect(sheet).toContain('<row r="3" ht="20" customHeight="1">');
    expect(sheet).toContain('<row r="4" ht="34" customHeight="1">');
    expect(sheet).toContain('<row r="5" ht="8" customHeight="1"/>');
    expect(sheet.match(/<mergeCell ref="[^"]+"/g)).toEqual([
      '<mergeCell ref="A1:H1"',
      '<mergeCell ref="A2:H2"',
      '<mergeCell ref="A3:H3"',
      '<mergeCell ref="A4:H4"',
    ]);
    expect(sheet).toContain('autoFilter ref="A6:H8"');
    expect(sheet).toContain('ySplit="6" topLeftCell="A7"');
    expect(sheet).toContain('orientation="landscape"');
    expect(files["xl/workbook.xml"]).toContain("'Items'!$6:$6");
    expect(files["xl/styles.xml"]).toContain('fgColor rgb="FF0B1B33"');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual(["TOOL-GRINDER", "Angle Grinder", "Tools", "pcs", "ASSET", "0", "", ""]);
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    expect(await (await upload(buffer)).json()).toMatchObject({ validCount: 2, rows: [{ line: 7 }, { line: 8 }] });
    expect((await upload(buffer, "commit")).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identifiers: { create: expect.objectContaining({ code: "001234567890" }) },
        }),
      }),
    );
  });

  it("previews without writes then revalidates and commits text codes", async () => {
    expect((await parseItemWorkbook(workbook())).headerRow).toBe(1);
    const response = await upload(workbook());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      validCount: 1,
      errorCount: 0,
      rows: [{ line: 2, data: { sku: "00123", barcode: "000987" } }],
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect((await upload(workbook(), "commit")).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sku: "00123",
          identifiers: { create: expect.objectContaining({ code: "000987" }) },
        }),
      }),
    );
    mocks.items.mockResolvedValue([{ sku: "00123" }]);
    expect((await upload(workbook(), "commit")).status).toBe(422);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("still accepts the previously shipped preamble with an implicit blank spacer", async () => {
    const response = await GET(new Request("http://localhost/api/v1/items/import"));
    const files = unzipXlsx(Buffer.from(await response.arrayBuffer()));
    files["xl/worksheets/sheet1.xml"] = files["xl/worksheets/sheet1.xml"].replace(
      '<row r="5" ht="8" customHeight="1"/>',
      "",
    );
    const parsed = await parseItemWorkbook(rezip(files));
    expect(parsed.headerRow).toBe(6);
    expect(parsed.rows[0]).toEqual(columns);
    expect((await upload(rezip(files))).status).toBe(200);
  });

  it("supports Excel shared strings, sparse cells and only the first worksheet", async () => {
    const files = unzipXlsx(workbook());
    files["xl/worksheets/sheet1.xml"] = files["xl/worksheets/sheet1.xml"].replace(
      '<c r="A2" s="3" t="inlineStr"><is><t xml:space="preserve">00123</t></is></c>',
      '<c r="A2" t="s"><v>0</v></c>',
    );
    files["xl/sharedStrings.xml"] =
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>00123</t></si></sst>';
    files["xl/_rels/workbook.xml.rels"] = files["xl/_rels/workbook.xml.rels"].replace(
      "</Relationships>",
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    );
    files["xl/workbook.xml"] = files["xl/workbook.xml"].replace(
      "</sheets>",
      '<sheet name="Ignored" sheetId="2" r:id="rId4"/></sheets>',
    );
    files["xl/worksheets/sheet2.xml"] = files["xl/worksheets/sheet1.xml"].replace("Goggles", "Ignored");
    const { rows } = await parseItemWorkbook(rezip(files));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["00123", "Goggles", "", "pcs", "STOCK", "2", "", "000987"]);
  });

  it("rejects cached formulas, row/column limits, corrupt files and zip bombs", async () => {
    for (const [replace, message] of [
      [(sheet: string) => sheet.replace("<v>2</v>", "<f>1+1</f><v>2</v>"), /Formula/],
      [(sheet: string) => sheet.replace('row r="2"', 'row r="2007"'), /2000/],
      [(sheet: string) => sheet.replace('r="H2"', 'r="I2"'), /eight template/],
    ] as const) {
      const files = unzipXlsx(workbook());
      files["xl/worksheets/sheet1.xml"] = replace(files["xl/worksheets/sheet1.xml"]);
      await expect(parseItemWorkbook(rezip(files))).rejects.toThrow(message);
    }
    await expect(parseItemWorkbook(Buffer.from("not Excel"))).rejects.toThrow(/invalid/);
    await expect(parseItemWorkbook(Buffer.alloc(2_000_001))).rejects.toThrow(/2 MB/);
    const bomb = rezip({ "large.xml": "x".repeat(MAX_EXPANDED_BYTES + 1) });
    await expect(parseItemWorkbook(bomb)).rejects.toThrow(/expanded workbook/);
    expect((await upload(workbook(), "preview", "items.xls")).status).toBe(422);
  });

  it("retains JSON CSV and multipart CSV preview/commit", async () => {
    const csv = columns.join(",") + "\r\n00123,Goggles,,pcs,STOCK,2,,000987\r\n";
    const response = await POST(
      new Request("http://localhost/api/v1/items/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, mode: "preview" }),
      }),
    );
    expect(await response.json()).toMatchObject({ validCount: 1 });
    expect((await upload(Buffer.from(csv), "commit", "items.csv")).status).toBe(201);
  });

  it("reports row validation errors and skips invalid rows using the existing rules", async () => {
    const buffer = toXlsx("Items", columns, [
      ["00123", "Goggles", "", "pcs", "STOCK", 2, "", "000987"],
      ["00123", "Duplicate", "Unknown", "missing", "OTHER", -1, "", "000987"],
    ]);
    const response = await upload(buffer);
    const preview = await response.json();
    expect(preview).toMatchObject({ validCount: 1, errorCount: 1 });
    expect(preview.rows[1].errors.join(" ")).toMatch(/Same SKU.*Same barcode/);
    expect((await upload(buffer, "commit")).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const quantities = toXlsx(
      "Items",
      [...columns.slice(0, 7), "quantity"],
      [["X", "Item", "", "pcs", "STOCK", 0, "", 50]],
    );
    expect((await upload(quantities)).status).toBe(422);
  });

  it("bounds multipart streams without Content-Length and rejects malformed uploads", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/items/import", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=oversized" },
        body: Buffer.alloc(2_100_000),
      }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("2 MB") });
    const malformed = await POST(
      new Request("http://localhost/api/v1/items/import", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=missing" },
        body: "bad upload",
      }),
    );
    expect(malformed.status).toBe(422);
    const files = unzipXlsx(workbook());
    files["xl/worksheets/sheet1.xml"] = files["xl/worksheets/sheet1.xml"].replace('r="H2"', 'r="H2007"');
    await expect(parseItemWorkbook(rezip(files))).rejects.toThrow(/2000/);
  });

  it("rejects malformed or unrecognized preambles without searching for later headers or skipping CSV rows", async () => {
    const response = await GET(new Request("http://localhost/api/v1/items/import"));
    const files = unzipXlsx(Buffer.from(await response.arrayBuffer()));
    for (const [from, to] of [
      ["Item Import Template", "Other title"],
      [">sku<", ">sku_typo<"],
      ["Generated: ", "Changed: "],
    ]) {
      const changed = { ...files, "xl/worksheets/sheet1.xml": files["xl/worksheets/sheet1.xml"].replace(from, to) };
      expect((await upload(rezip(changed))).status).toBe(422);
    }
    const arbitrary = toXlsx("Items", columns, [["X", "Item", "", "pcs", "STOCK", 0]], [], {
      company: "Acme",
      title: "Unrecognized",
      details: ["Notes"],
    });
    expect((await upload(arbitrary)).status).toBe(422);
    expect(
      (await upload(Buffer.from("Acme\n" + columns.join(",") + "\nX,Item,,pcs,STOCK,0,,"), "preview", "items.csv"))
        .status,
    ).toBe(422);
  });

  it("reports blank, invalid and duplicate data at raw Excel rows and caps data independently of metadata", async () => {
    const response = await GET(new Request("http://localhost/api/v1/items/import"));
    const files = unzipXlsx(Buffer.from(await response.arrayBuffer()));
    // A blank row between examples must not shift subsequent validation or duplicate references.
    files["xl/worksheets/sheet1.xml"] = files["xl/worksheets/sheet1.xml"]
      .replace(/(<row r="8".*?<\/row>)/, (row) => '<row r="8"/>' + row.replace(/([A-H]?)8"/g, '$19"'))
      .replace("TOOL-GRINDER", "PPE-0100");
    const preview = await (await upload(rezip(files))).json();
    expect(preview.rows.map((row: { line: number }) => row.line)).toEqual([7, 8, 9]);
    expect(preview.rows[1].ok).toBe(false);
    expect(preview.rows[2].errors).toContain("Same SKU as line 7.");
    const template = unzipXlsx(
      Buffer.from(await (await GET(new Request("http://localhost/api/v1/items/import"))).arrayBuffer()),
    );
    const sheet = template["xl/worksheets/sheet1.xml"];
    const data = sheet.match(/<row r="7".*?<\/row>/)![0];
    const first = sheet.slice(0, sheet.indexOf('<row r="7"'));
    const last = sheet.slice(sheet.indexOf("</sheetData>"));
    const filled = (count: number) =>
      rezip({
        ...template,
        "xl/worksheets/sheet1.xml":
          first +
          Array.from({ length: count }, (_, i) =>
            data.replace(/([A-H]?)7"/g, (_, col: string) => `${col}${i + 7}"`),
          ).join("") +
          last,
      });
    expect((await parseItemWorkbook(filled(2000))).rows).toHaveLength(2001);
    await expect(parseItemWorkbook(filled(2001))).rejects.toThrow(/2000/);
    const oldRows = Array.from({ length: 2001 }, () => ["X", "Item", "", "pcs", "STOCK", 0]);
    await expect(parseItemWorkbook(toXlsx("Items", columns, oldRows))).rejects.toThrow(/2000/);
    const formula = { ...template, "xl/worksheets/sheet1.xml": sheet.replace("<v>10</v>", "<f>5+5</f><v>10</v>") };
    expect((await upload(rezip(formula))).status).toBe(422);
  });

  it("enforces authentication and import permission before parsing or querying", async () => {
    for (const [user, status] of [
      [null, 401],
      [{ id: "field", role: "FIELD", status: "ACTIVE", locations: [] }, 403],
      [{ id: "admin", role: "ADMIN", status: "INACTIVE", locations: [] }, 401],
    ] as const) {
      mocks.user.mockResolvedValue(user);
      expect((await GET(new Request("http://localhost/api/v1/items/import"))).status).toBe(status);
      expect((await upload(Buffer.from("bad"))).status).toBe(status);
      expect((await upload(Buffer.from("bad"), "commit")).status).toBe(status);
    }
    expect(mocks.units).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
