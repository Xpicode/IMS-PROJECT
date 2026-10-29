/**
 * Text search filters for Prisma. Prisma's `contains` passes `%` and `_` straight
 * into SQL LIKE, so a search for "_" matched every row. Escape them so search
 * text is always literal.
 */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** Case-insensitive "contains" for user text. */
export const has = (q: string) => ({ contains: likeEscape(q), mode: "insensitive" as const });

/** "contains" for upper-case codes (references, tags). */
export const hasCode = (q: string) => ({ contains: likeEscape(q.toUpperCase()) });
