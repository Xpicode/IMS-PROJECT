import "server-only";
import { prisma } from "@/lib/db/prisma";
import { dummyHash, verifyPassword } from "./password";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * `{ id }` for valid credentials of an ACTIVE account, `{ inactive: true }` for
 * the right password on a deactivated account (so the login page can say why),
 * otherwise null. Unknown email and wrong password look the same.
 */
export async function verifyCredentials(email: string, password: string) {
  if (typeof email !== "string" || typeof password !== "string") return null;
  if (email.length > 254 || password.length > 200) return null;
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, passwordHash: true, status: true },
  });
  if (!user) {
    await verifyPassword(await dummyHash(), password); // similar timing for unknown emails
    return null;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) return null;
  if (user.status !== "ACTIVE") return { inactive: true as const };
  return { id: user.id };
}
