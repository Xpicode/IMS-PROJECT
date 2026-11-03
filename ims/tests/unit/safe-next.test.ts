import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext (login redirect)", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/locations?q=wh")).toBe("/locations?q=wh");
  });
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    // Browsers drop tabs and newlines in URLs, so these become //evil.example.
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r\n/evil.example",
    "",
    null,
    42,
  ])("rejects %j", (v) => {
    expect(safeNext(v)).toBe("/");
  });
});
