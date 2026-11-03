import { expect, it } from "vitest";
import { ALL_ROWS, pageSizeParam, RECENT_SIZES } from "@/lib/paging";

it("rows per page: 20, 50, 100 or all from ?size=, otherwise 20", () => {
  expect([undefined, "50", "100", ["50", "20"], "all"].map((v) => pageSizeParam(v))).toEqual([
    20,
    50,
    100,
    50,
    ALL_ROWS,
  ]);
  // Anything else falls back to 20, so a hand-edited URL can't ask for thousands of rows.
  expect(["", "0", "-5", "21", "5000", "abc", "ALL"].map((v) => pageSizeParam(v))).toEqual([
    20, 20, 20, 20, 20, 20, 20,
  ]);
});

it("Recent activity: starts at 10 and also offers 10", () => {
  expect([undefined, "10", "20", "15", "all"].map((v) => pageSizeParam(v, RECENT_SIZES))).toEqual([
    10,
    10,
    20,
    10,
    ALL_ROWS,
  ]);
  expect(pageSizeParam("10")).toBe(20); // 10 isn't an option on the other lists
});
