import { describe, expect, it } from "vitest";
import { allowedNextStatuses, checkTransition } from "@/lib/assets/transitions";

describe("asset status transitions (§9.4)", () => {
  it("only a confirmed release can borrow an available asset", () => {
    expect(checkTransition("AVAILABLE", "BORROWED", "manual")).toMatch(/release/i);
    expect(checkTransition("AVAILABLE", "BORROWED", "release")).toBeNull();
  });

  it("a borrowed asset comes back only through a return inspection", () => {
    expect(checkTransition("BORROWED", "AVAILABLE", "manual")).toMatch(/return/i);
    expect(checkTransition("BORROWED", "AVAILABLE", "return")).toBeNull();
    expect(checkTransition("BORROWED", "UNDER_MAINTENANCE", "return")).toBeNull();
    expect(checkTransition("BORROWED", "NEEDS_REVIEW", "return")).toBeNull();
  });

  it("a retired asset can never change status, and can't be borrowed", () => {
    for (const to of ["AVAILABLE", "BORROWED", "NEEDS_REVIEW", "LOST"] as const) {
      expect(checkTransition("RETIRED", to, "manual")).not.toBeNull();
    }
    expect(checkTransition("RETIRED", "BORROWED", "release")).not.toBeNull();
  });

  it("allows the everyday manual changes", () => {
    expect(checkTransition("AVAILABLE", "UNDER_MAINTENANCE", "manual")).toBeNull();
    expect(checkTransition("UNDER_MAINTENANCE", "AVAILABLE", "manual")).toBeNull();
    expect(checkTransition("NEEDS_REVIEW", "RETIRED", "manual")).toBeNull();
    expect(checkTransition("LOST", "NEEDS_REVIEW", "manual")).toBeNull();
  });

  it("rejects a no-op change", () => {
    expect(checkTransition("AVAILABLE", "AVAILABLE", "manual")).not.toBeNull();
  });

  it("a found lost asset is reviewed first, never straight back to available", () => {
    expect(checkTransition("LOST", "AVAILABLE", "manual")).not.toBeNull();
  });

  it("lists what the status screen may offer", () => {
    expect(allowedNextStatuses("AVAILABLE", "manual").sort()).toEqual([
      "LOST",
      "NEEDS_REVIEW",
      "RETIRED",
      "UNDER_MAINTENANCE",
    ]);
    expect(allowedNextStatuses("BORROWED", "manual")).toEqual(["LOST"]);
    expect(allowedNextStatuses("RETIRED", "manual")).toEqual([]);
  });
});
