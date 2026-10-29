import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/reports/csv";

describe("CSV export (§9.5)", () => {
  it("quotes every cell and doubles quotes inside", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it.each([
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ["+1+1", `"'+1+1"`],
    ["-2+3", `"'-2+3"`],
    ["@SUM(A1)", `"'@SUM(A1)"`],
    ["\t=1", `"'\t=1"`],
    ["\r=1", `"'\r=1"`],
    ["  =1", `"'  =1"`],
  ])("defuses a formula in user text: %j", (input, out) => {
    expect(csvCell(input)).toBe(out);
  });

  it("keeps real numbers (including negatives) as numbers", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("writes a header, CRLF line ends, and a UTF-8 BOM so Excel shows Peña", () => {
    const s = toCsv(
      ["Name", "Qty"],
      [
        ["José Peña", 3],
        ["=cmd", -1],
      ],
    );
    expect(s.startsWith("\uFEFF")).toBe(true);
    expect(s.slice(1)).toBe('"Name","Qty"\r\n"José Peña",3\r\n"\'=cmd",-1\r\n');
  });
});
