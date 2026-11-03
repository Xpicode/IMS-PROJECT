import { expect, it } from "vitest";
import { ALL_ROWS, pageSizeParam } from "@/lib/paging";

it("rows per page: 20, 50, 100 or all from ?size=, otherwise 20", () => {
  expect([undefined, "50", "100", ["50", "20"], "all"].map(pageSizeParam)).toEqual([20, 50, 100, 50, ALL_ROWS]);
  // Anything else falls back to 20, so a hand-edited URL can't ask for thousands of rows.
  expect(["", "0", "-5", "21", "5000", "abc", "ALL"].map(pageSizeParam)).toEqual([20, 20, 20, 20, 20, 20, 20]);
});
