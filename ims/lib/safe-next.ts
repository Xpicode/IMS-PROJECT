const BASE = "http://ims.invalid";

/**
 * Only same-site relative paths, so ?next= can't send users to another site.
 * The URL parser decides, the way a browser would: it reads "/\evil" and
 * "/<tab>/evil" as //evil (another host), which a prefix check misses.
 */
export function safeNext(v: unknown, fallback = "/") {
  if (typeof v !== "string" || !v.startsWith("/")) return fallback;
  try {
    const u = new URL(v, BASE);
    return u.origin === BASE ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}
