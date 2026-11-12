import { describe, expect, it } from "vitest";
import { excelDate, toXlsx } from "@/lib/xlsx";
import { SaxesParser } from "saxes";
import { readSheet } from "read-excel-file/node";
import { unzipXlsx as unzip } from "../xlsx-helpers";

describe("toXlsx", () => {
  const sheet = (header: string[], rows: (string | number | null)[][]) =>
    unzip(toXlsx("Items", header, rows))["xl/worksheets/sheet1.xml"];

  it("packs a complete workbook", () => {
    expect(Object.keys(unzip(toXlsx("Items", ["sku"], [["A"]]))).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("styles the header, right-aligning it over numbers, and freezes it", () => {
    const x = sheet(["sku", "on_hand"], [["A", 4]]);
    expect(x).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(x).toContain('<c r="B1" s="2" t="inlineStr">');
    expect(x).toContain('state="frozen"');
  });

  it("keeps numbers as numbers and codes as text", () => {
    const x = sheet(["sku", "n"], [["00123", 5]]);
    expect(x).toContain('<t xml:space="preserve">00123</t>');
    expect(x).toContain('<c r="B2" s="4"><v>5</v></c>');
  });

  it("stores dangerous text as harmless text", () => {
    const x = sheet(["a"], [['=HYPERLINK("x")'], ["<b>&\u0001"]]);
    expect(x).not.toContain("<f>");
    expect(x).toContain('=HYPERLINK("x")');
    expect(x).toContain("&lt;b&gt;&amp;<");
  });

  it("sizes columns to content within limits and styles empty cells", () => {
    const x = sheet(["a", "b", "c"], [["x".repeat(20), "y".repeat(500), null]]);
    expect(x).toContain('<col min="1" max="1" width="22"');
    expect(x).toContain('<col min="2" max="2" width="50"');
    expect(x).toContain('<col min="3" max="3" width="8"');
    expect(x).toContain('<c r="C2" s="3"/>');
  });

  it("names columns past Z", () => {
    const header = Array.from({ length: 28 }, (_, i) => `h${i}`);
    expect(sheet(header, [])).toContain('r="AB1"');
  });

  it("cuts a cell to Excel's limit", () => {
    expect(sheet(["a"], [["z".repeat(40000)]]).match(/z{100,}/)?.[0].length).toBe(32767);
  });

  it("formats report integers, signed movements and real Excel dates without converting text IDs", () => {
    const files = unzip(
      toXlsx(
        "Report",
        ["ID", "Qty", "Change", "Due", "At"],
        [["00123", 1234, -5, 46332, 46332.5]],
        [undefined, "integer", "signed", "date", "datetime"],
      ),
    );
    const x = files["xl/worksheets/sheet1.xml"];
    expect(x).toContain('<c r="A2" s="3" t="inlineStr">');
    for (const [ref, style, value] of [
      ["B2", 5, 1234],
      ["C2", 6, -5],
      ["D2", 7, 46332],
      ["E2", 8, 46332.5],
    ]) {
      expect(x).toContain(`<c r="${ref}" s="${style}"><v>${value}</v></c>`);
    }
    expect(files["xl/styles.xml"]).toContain('cellXfs count="20"');
    expect(files["xl/styles.xml"]).toContain('formatCode="+#,##0;-#,##0;0"');
    expect(files["xl/styles.xml"]).toContain('formatCode="d mmm yyyy, h:mm AM/PM"');
  });

  it("converts UTC to company-local dates across midnight, retaining minutes", () => {
    expect(excelDate(new Date("2026-11-05T16:30:59Z"))).toBe(46332 + 30 / 1440);
    expect(excelDate(new Date("2026-11-05T16:30:59Z"), true)).toBe(46332);
  });

  it("offsets report headings, data, merges and filters without changing Items defaults", () => {
    const files = unzip(
      toXlsx("Report", ["ID", "Qty"], [["001", 3]], [undefined, "integer"], {
        company: "A & B",
        title: "Stock",
        details: ["Exported rows: 1"],
      }),
    );
    const x = files["xl/worksheets/sheet1.xml"];
    expect(x).toContain('r="A1" s="10"');
    expect(x).toContain('r="A2" s="9"');
    expect(x).toContain("A &amp; B");
    expect(x).toContain('r="A5" s="1"');
    expect(x).toContain('<c r="B6" s="5"><v>3</v></c>');
    expect(x).toContain('ySplit="5" topLeftCell="A6"');
    expect(x).toContain('autoFilter ref="A5:B6"');
    expect(x).toContain('mergeCell ref="A2:B2"');
    expect(files["xl/styles.xml"]).toContain('cellXfs count="20"');
    const items = sheet(["ID", "Qty"], [["001", 3]]);
    expect(items).toContain('ySplit="1" topLeftCell="A2"');
    expect(items).toContain('autoFilter ref="A1:B2"');
    expect(items).not.toContain("mergeCells");
  });

  it("uses the app palette, readable type and matching banded number/text styles", async () => {
    const rows = [
      ["00123", 1234, -5, 46332, 46332.5, "=SUM(A1)", null],
      ["00002", 0, 5, 46333, 46333.5, "@text", null],
    ];
    const buffer = toXlsx("Items", ["sku", "qty", "change", "due", "at", "note", "empty"], rows, [
      "text",
      "integer",
      "signed",
      "date",
      "datetime",
    ]);
    const files = unzip(buffer);
    const styles = files["xl/styles.xml"];
    expect(styles).toContain('<name val="Arial"/>');
    for (const color of ["FF0B1B33", "FF2563EB", "FFF8FAFC", "FFE2E8F0"]) expect(styles).toContain(color);
    const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)![1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)!;
    expect(xfs).toHaveLength(20);
    for (const [base, band] of [
      [3, 12],
      [4, 13],
      [5, 14],
      [6, 15],
      [7, 16],
      [8, 17],
      [11, 18],
    ]) {
      expect(xfs[band]).toBe(xfs[base].replace('fillId="0"', 'fillId="3"'));
    }
    for (const xml of Object.values(files)) {
      expect(() => new SaxesParser({ xmlns: true }).write(xml).close()).not.toThrow();
    }
    const sheet = files["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<c r="A3" s="18" t="inlineStr">');
    expect(sheet).toContain('<c r="B3" s="14"><v>0</v></c>');
    expect(sheet).toContain('<c r="G3" s="12"/>');
    expect(sheet).not.toContain("<f>");
    const parsed = await readSheet(buffer, 1);
    expect(parsed[1].slice(0, 3)).toEqual(["00123", 1234, -5]);
    expect(parsed[2].slice(0, 3)).toEqual(["00002", 0, 5]);
    expect(parsed[1][5]).toBe("=SUM(A1)");
  });

  it("sets compact spacing, bounded wrapped rows and valid print titles for quoted sheet names", () => {
    const files = unzip(toXlsx('Team\'s "Stock"', ["Description"], [["line\n" + "x".repeat(500)]]));
    const x = files["xl/worksheets/sheet1.xml"];
    expect(x).toContain('showGridLines="0"');
    expect(x).toContain('<row r="1" ht="30" customHeight="1">');
    expect(x).toContain('<row r="2" ht="96" customHeight="1">');
    expect(x).toContain('<pageSetUpPr fitToPage="1"/>');
    expect(x).toContain('orientation="landscape" fitToWidth="1" fitToHeight="0"');
    expect(x).toContain('<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5"');
    expect(files["xl/workbook.xml"]).toContain(`'Team''s &quot;Stock&quot;'!$1:$1`);
  });

  it("repeats the actual report heading and filters only the table, even when empty", () => {
    const files = unzip(
      toXlsx("Stock", ["SKU", "Qty"], [], ["text", "integer"], {
        company: "Company",
        title: "Stock",
        details: ["Exported rows: 0", "Active filters: None"],
      }),
    );
    const x = files["xl/worksheets/sheet1.xml"];
    expect(x).toContain('ySplit="6" topLeftCell="A7"');
    expect(x).toContain('autoFilter ref="A6:B6"');
    expect(x).toContain('dimension ref="A1:B6"');
    expect(x).toContain('r="A3" s="19"');
    expect(files["xl/workbook.xml"]).toContain(`'Stock'!$6:$6`);
  });

  it("centers the company, title and muted metadata across the table and printed page", async () => {
    const buffer = toXlsx("Items", ["SKU", "Name", "Qty"], [["001", "Gloves", 3]], ["text", undefined, "integer"], {
      company: "Acme & Co",
      title: "Items",
      details: ["Exported: today", "Exported rows: 1"],
    });
    const files = unzip(buffer);
    const x = files["xl/worksheets/sheet1.xml"];
    for (const [row, height, style] of [
      [1, 24, 10],
      [2, 34, 9],
      [3, 20, 19],
      [4, 20, 19],
    ]) {
      expect(x).toContain(`<row r="${row}" ht="${height}" customHeight="1"><c r="A${row}" s="${style}"`);
    }
    expect(x).toContain('<row r="5" ht="8" customHeight="1"/>');
    expect(x).toContain('<row r="6" ht="30" customHeight="1">');
    expect(x.match(/<mergeCell ref="[^"]+"/g)).toEqual([
      '<mergeCell ref="A1:C1"',
      '<mergeCell ref="A2:C2"',
      '<mergeCell ref="A3:C3"',
      '<mergeCell ref="A4:C4"',
    ]);
    expect(x).toContain('showGridLines="0"');
    expect(x).toContain('ySplit="6" topLeftCell="A7"');
    expect(x).toContain('autoFilter ref="A6:C7"');
    expect(x).toContain('<printOptions horizontalCentered="1"/>');
    expect(files["xl/workbook.xml"]).toContain('name="_xlnm.Print_Area" localSheetId="0">\'Items\'!$A$1:$C$7');
    const xfs = files["xl/styles.xml"]
      .match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)![1]
      .match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)!;
    for (const style of [9, 10, 19]) {
      expect(xfs[style]).toContain('horizontal="center" vertical="center" wrapText="1"');
      expect(xfs[style]).toContain('fillId="0" borderId="0"');
    }
    const fonts = files["xl/styles.xml"].match(/<font>[\s\S]*?<\/font>/g)!;
    expect(fonts[2]).toContain('<b/><sz val="18"/><color rgb="FF0B1B33"/>');
    expect(fonts[3]).toContain('<b/><sz val="12"/><color rgb="FF0B1B33"/>');
    expect(fonts[4]).toContain('<sz val="10"/><color rgb="FF475569"/>');
    expect(xfs[1]).toContain('horizontal="left" vertical="center"');
    expect(xfs[2]).toContain('horizontal="right" vertical="center"');
    expect(xfs[5]).toContain('numFmtId="3"');
    expect(xfs[5]).not.toContain('horizontal="center"');
    expect(x).toContain('<c r="C6" s="2"');
    expect(x).toContain('<c r="C7" s="5"><v>3</v></c>');
    const parsed = await readSheet(buffer, 1);
    expect(parsed[4]).toEqual([null, null, null]);
    expect(parsed[5]).toEqual(["SKU", "Name", "Qty"]);
    expect(parsed[6]).toEqual(["001", "Gloves", 3]);
    for (const xml of Object.values(files)) {
      expect(() => new SaxesParser({ xmlns: true }).write(xml).close()).not.toThrow();
    }
  });

  it("sizes multiline and narrow-sheet headers using their fonts without merging table cells", () => {
    const files = unzip(
      toXlsx("Notes", ["ID"], [], [], {
        company: "Acme\nTools",
        title: "A long report title",
        details: ["One\nTwo\nThree"],
      }),
    );
    const x = files["xl/worksheets/sheet1.xml"];
    expect(x).toContain('<row r="1" ht="60" customHeight="1">');
    expect(x).toContain('<row r="2" ht="178" customHeight="1">');
    expect(x).toContain('<row r="3" ht="48" customHeight="1">');
    expect(x).not.toContain("mergeCells");
    expect(x).toContain('autoFilter ref="A5:A5"');
    expect(sheet(["A\nB\nC"], [])).toContain('<row r="1" ht="53" customHeight="1">');
  });

  it("grows wrapped metadata to the available table width without adding rows", () => {
    const metadata = { company: "Acme", title: "Stock", details: ["Active filters: " + "Warehouse ".repeat(12)] };
    const narrow = unzip(toXlsx("Stock", ["SKU", "Qty"], [], [], metadata))["xl/worksheets/sheet1.xml"];
    const wide = unzip(toXlsx("Stock", ["Description".repeat(5), "Location".repeat(6)], [], [], metadata))[
      "xl/worksheets/sheet1.xml"
    ];
    const height = (xml: string) => Number(xml.match(/<row r="3" ht="(\d+)"/)![1]);
    expect(height(narrow)).toBeGreaterThan(height(wide));
    expect(height(wide)).toBeGreaterThan(20);
    for (const xml of [narrow, wide]) {
      expect(xml.match(/<row /g)).toHaveLength(5);
      expect(xml).toContain('mergeCell ref="A3:B3"');
      expect(xml).toContain('autoFilter ref="A5:B5"');
    }
  });
});
