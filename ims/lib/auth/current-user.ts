import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadAccessUser, type CurrentUser } from "@/lib/users/access";
import { touchSession } from "./sessions";
import { readCookie, SESSION_COOKIE } from "./cookie";

async function userFromToken(token: string | undefined): Promise<CurrentUser | null> {
  if (!token) return null;
  const s = await touchSession(token);
  if (!s) return null;
  const user = await loadAccessUser(s.userId);
  return user && user.status === "ACTIVE" ? user : null;
}

/** For Route Handlers: reads the session cookie from the request. */
export function getRequestUser(req: Request) {
  return userFromToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

/** For Server Components and Server Actions. Deduplicated per request. */
export const getCurrentUser = cache(async () => {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
});

/** Server Components: the signed-in user, or a redirect to /login. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
