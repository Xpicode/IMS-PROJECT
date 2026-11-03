/** "Rows per page" on the lists (DataList): ?size= in the URL. 20 by default. */
export const PAGE_SIZES = [20, 50, 100] as const;
/** Dashboard "Recent activity" starts shorter. */
export const RECENT_SIZES = [10, 20, 50, 100] as const;
/** "All" (?size=all). ponytail: capped so one page stays fast; past 1,000 rows the page buttons take over. */
export const ALL_ROWS = 1000;

/** The size from ?size=; anything not offered falls back to the first (the default). */
export function pageSizeParam(v: string | string[] | undefined, sizes: readonly number[] = PAGE_SIZES): number {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === "all") return ALL_ROWS;
  const n = Number(s);
  return sizes.includes(n) ? n : sizes[0];
}
