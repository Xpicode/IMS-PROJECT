/** Only same-site relative paths, so ?next= can't send users to another site. */
export function safeNext(v: unknown, fallback = "/") {
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  return v;
}
