import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toXlsx } from "@/lib/xlsx";

/** Read the zip through its central directory, as Excel does, checking every crc. */
function unzip(buf: Buffer): Record<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("ascii", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const raw = inflateRawSync(buf.subarray(start, start + size));
    expect(crc32(raw)).toBe(buf.readUInt32LE(p + 16));
    out[name] = raw.toString("utf8");
    p += 46 + nameLen;
  }
  return out;
}

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

  it("sizes columns to content within limits and skips empty cells", () => {
    const x = sheet(["a", "b", "c"], [["x".repeat(20), "y".repeat(500), null]]);
    expect(x).toContain('<col min="1" max="1" width="22"');
    expect(x).toContain('<col min="2" max="2" width="50"');
    expect(x).toContain('<col min="3" max="3" width="8"');
    expect(x).not.toContain('r="C2"');
  });

  it("names columns past Z", () => {
    const header = Array.from({ length: 28 }, (_, i) => `h${i}`);
    expect(sheet(header, [])).toContain('r="AB1"');
  });

  it("cuts a cell to Excel's limit", () => {
    expect(sheet(["a"], [["z".repeat(40000)]]).match(/z{100,}/)?.[0].length).toBe(32767);
  });
});
