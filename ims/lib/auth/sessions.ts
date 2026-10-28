import "server-only";
import { prisma } from "@/lib/db/prisma";
import { randomToken, sha256 } from "@/lib/crypto";

/** Sign-in lasts 12 hours, extended while the user is active. */
export const SESSION_MAX_AGE_S = 12 * 60 * 60;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export async function createSession(userId: string, userAgent?: string | null) {
  const token = randomToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_S * 1000),
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  });
  return token;
}

/** Returns the session if it exists, is unexpired, and its user is active. */
export async function resolveSession(token: string | undefined | null) {
  if (!token || token.length > 200) return null;
  const s = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, expiresAt: true, lastSeenAt: true, user: { select: { status: true } } },
  });
  if (!s || s.expiresAt.getTime() <= Date.now() || s.user.status !== "ACTIVE") return null;
  return { id: s.id, userId: s.userId, expiresAt: s.expiresAt, lastSeenAt: s.lastSeenAt };
}

/** Sliding expiry, written at most every few minutes. */
export async function touchSession(token: string) {
  const s = await resolveSession(token);
  if (!s) return null;
  if (Date.now() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.session.update({
      where: { id: s.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_MAX_AGE_S * 1000) },
    });
  }
  return s;
}

export async function deleteSession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

/** Ends every session for a user (deactivation, role/location/password change). */
export async function deleteUserSessions(userId: string, db: { session: typeof prisma.session } = prisma) {
  await db.session.deleteMany({ where: { userId } });
}
