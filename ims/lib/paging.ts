/** "Rows per page" on the lists (DataList): ?size= in the URL. 20 by default. */
export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];
/** "All" (?size=all). ponytail: capped so one page stays fast; past 1,000 rows the page buttons take over. */
export const ALL_ROWS = 1000;

export function pageSizeParam(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === "all") return ALL_ROWS;
  const n = Number(s);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}
