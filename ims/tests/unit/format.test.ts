import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/lib/format";

describe("formatDateTime (§3.6: 28 Oct 2026, 2:30 PM in the company timezone)", () => {
  it("formats a UTC instant in the given timezone", () => {
    expect(formatDateTime("2026-10-28T06:30:00Z", "Asia/Manila")).toBe("28 Oct 2026, 2:30 PM");
  });
  it("handles midnight and single-digit days", () => {
    expect(formatDateTime(new Date("2026-03-04T16:05:00Z"), "Asia/Manila")).toBe("5 Mar 2026, 12:05 AM");
  });
  it("shows a dash for missing values", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});
