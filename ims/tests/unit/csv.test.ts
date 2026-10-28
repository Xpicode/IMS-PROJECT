import { describe, expect, it } from "vitest";
import { parseCsv, toCsv, escapeCell } from "@/lib/csv";

describe("parseCsv", () => {
  it("reads headers and rows", () => {
    expect(parseCsv("sku,name\nPPE-1,Gloves\n")).toEqual([
      ["sku", "name"],
      ["PPE-1", "Gloves"],
    ]);
  });
  it("handles quotes, commas, doubled quotes, and newlines inside quotes", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n"line1\nline2",z')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["line1\nline2", "z"],
    ]);
  });
  it("strips a UTF-8 BOM and skips blank lines", () => {
    expect(parseCsv("\uFEFFsku\n\nA\n\n")).toEqual([["sku"], ["A"]]);
  });
  it("throws on an unclosed quote", () => {
    expect(() => parseCsv('a\n"oops')).toThrow(/quote/i);
  });
});

describe("toCsv / escapeCell (§9.5 formula injection)", () => {
  it("neutralizes cells that a spreadsheet would run as a formula", () => {
    for (const bad of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) {
      expect(escapeCell(bad).startsWith("'") || escapeCell(bad).startsWith(`"'`)).toBe(true);
    }
  });
  it("keeps negative numbers as numbers", () => {
    expect(escapeCell(-5)).toBe("-5");
  });
  it("quotes commas, quotes, and newlines", () => {
    expect(toCsv([["a,b", 'q"q', "l1\nl2", 3]])).toBe('"a,b","q""q","l1\nl2",3\r\n');
  });
  it("round-trips through parseCsv", () => {
    const rows = [
      ["sku", "name"],
      ["X-1", 'Gloves, "large"'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
