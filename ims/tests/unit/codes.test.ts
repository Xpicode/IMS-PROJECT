import { describe, expect, it } from "vitest";
import { codeVariants, labelPayload, normalizeCode, parseScan } from "@/lib/codes";

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-901234567890";

describe("scan codes (§6.3)", () => {
  it("builds and reads the IMS label payload", () => {
    expect(labelPayload("item", ID)).toBe(`ims:item:${ID}`);
    expect(parseScan(`ims:asset:${ID}`)).toEqual({ kind: "ims", type: "asset", id: ID });
    expect(parseScan(` IMS:LOCATION:${ID.toUpperCase()} `)).toEqual({ kind: "ims", type: "location", id: ID });
  });
  it("treats anything else as a plain code to look up", () => {
    expect(parseScan(" ppe 0001 ")).toEqual({ kind: "code", code: "PPE0001" });
    expect(parseScan("ims:item:not-a-uuid")).toEqual({ kind: "code", code: "IMS:ITEM:NOT-A-UUID" });
  });
  it("normalizes codes: trim, upper-case, no inner spaces", () => {
    expect(normalizeCode(" 0 12345 67890 5 ")).toBe("012345678905");
  });
  it("rejects empty input", () => {
    expect(parseScan("   ")).toBeNull();
  });
});

describe("UPC-A / EAN-13 equivalence", () => {
  it("treats a 12-digit UPC-A and its 13-digit EAN-13 form (leading 0) as the same code", () => {
    expect(codeVariants("036000291452")).toEqual(["036000291452", "0036000291452"]);
    expect(codeVariants("0036000291452")).toEqual(["0036000291452", "036000291452"]);
  });
  it("leaves other codes alone", () => {
    expect(codeVariants("4006381333931")).toEqual(["4006381333931"]);
    expect(codeVariants("PPE-0001")).toEqual(["PPE-0001"]);
    expect(codeVariants("12345")).toEqual(["12345"]);
  });
});
