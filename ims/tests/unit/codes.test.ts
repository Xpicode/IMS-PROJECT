import { describe, expect, it } from "vitest";
import { labelPayload, normalizeCode, parseScan } from "@/lib/codes";

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
