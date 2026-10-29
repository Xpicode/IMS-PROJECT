import "server-only";
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { sha256 } from "@/lib/crypto";
import { dummyHash, verifyPassword } from "./password";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** 5 wrong passwords within 15 minutes lock that email for 15 minutes (§16; NGINX also limits per IP). */
export const LOGIN_LOCK = { attempts: 5, windowMs: 15 * 60_000 } as const;

/** Audit key for an email: a hash, so the log never holds a typed (maybe mistyped) address. */
const loginKey = (email: string) => sha256(`login:${normalizeEmail(email)}`);

/**
 * `{ id }` for valid credentials of an ACTIVE account, `{ inactive: true }` for
 * the right password on a deactivated account (so the login page can say why),
 * `{ locked: true }` after too many failures, otherwise null. Unknown email and
 * wrong password look the same, and both count towards the lock.
 */
export async function verifyCredentials(email: string, password: string, now: Date = new Date()) {
  if (typeof email !== "string" || typeof password !== "string") return null;
  if (email.length > 254 || password.length > 200) return null;
  const key = loginKey(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, passwordHash: true, status: true, lastLoginAt: true },
  });

  // Failures since the window started or since the last successful sign-in, whichever is later.
  const windowStart = now.getTime() - LOGIN_LOCK.windowMs;
  const since = new Date(Math.max(windowStart, user?.lastLoginAt?.getTime() ?? 0));
  const failures = await prisma.auditEvent.count({
    where: { eventType: "auth.login_failed", recordType: "login", recordId: key, createdAt: { gt: since } },
  });
  if (failures >= LOGIN_LOCK.attempts) {
    // Don't check the password at all while locked, so guessing gains nothing.
    await writeAudit(prisma, { actorId: null, eventType: "auth.login_locked", recordType: "login", recordId: key });
    return { locked: true as const };
  }

  const fail = async () => {
    await writeAudit(prisma, { actorId: null, eventType: "auth.login_failed", recordType: "login", recordId: key });
    return null;
  };
  if (!user) {
    await verifyPassword(await dummyHash(), password); // similar timing for unknown emails
    return fail();
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) return fail();
  if (user.status !== "ACTIVE") return { inactive: true as const };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  return { id: user.id };
}
