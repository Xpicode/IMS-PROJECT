import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext (login redirect)", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/locations?q=wh")).toBe("/locations?q=wh");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "", null, 42])("rejects %s", (v) => {
    expect(safeNext(v)).toBe("/");
  });
});
