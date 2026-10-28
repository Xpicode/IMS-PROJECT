/**
 * Session cookie: HTTP-only, SameSite=Lax, Secure over HTTPS (§16).
 * Over HTTPS the __Host- prefix also pins it to this exact host and path "/".
 */
export const SECURE_COOKIES = (process.env.AUTH_URL ?? "").startsWith("https://");
export const SESSION_COOKIE = SECURE_COOKIES ? "__Host-ims_session" : "ims_session";

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
