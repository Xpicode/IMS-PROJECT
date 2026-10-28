import "server-only";
import { prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { deleteUserSessions } from "@/lib/auth/sessions";
import { randomToken, sha256 } from "@/lib/crypto";
import type { Ctx } from "@/lib/context";
import {
  createUserSchema,
  parse,
  resetPasswordSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/lib/validation";

/** Fields that are safe to return to the client. Never the password hash. */
const publicUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  locations: {
    select: { access: true, location: { select: { id: true, code: true, name: true } } },
    orderBy: { location: { code: "asc" } },
  },
} as const;

export const RESET_LINK_TTL_MS = 60 * 60 * 1000;

async function assertLocationsExist(ids: string[]) {
  if (ids.length === 0) return;
  const n = await prisma.location.count({ where: { id: { in: ids } } });
  if (n !== ids.length) {
    throw new ApiError("VALIDATION_FAILED", "One of the chosen locations no longer exists. Refresh and try again.", {
      fields: { locations: ["Unknown location."] },
    });
  }
}

export async function listUsers(actor: AccessUser) {
  requireAccess(actor, "settings.manage");
  return prisma.user.findMany({ select: publicUser, orderBy: [{ status: "asc" }, { name: "asc" }] });
}

export async function getUser(actor: AccessUser, id: string) {
  requireAccess(actor, "settings.manage");
  const u = await prisma.user.findUnique({ where: { id }, select: publicUser });
  if (!u) throw errors.notFound("user");
  return u;
}

export async function createUser(actor: AccessUser, input: CreateUserInput, ctx: Ctx) {
  requireAccess(actor, "settings.manage");
  const data = parse(createUserSchema, input);
  await assertLocationsExist(data.locations.map((l) => l.id));

  const exists = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (exists) {
    throw new ApiError("DUPLICATE", "A user with this email already exists.", {
      fields: { email: ["This email is already in use."] },
    });
  }
  const passwordHash = await hashPassword(data.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        locations: { create: data.locations.map((l) => ({ locationId: l.id, access: l.access })) },
      },
      select: publicUser,
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "user.created",
      recordType: "user",
      recordId: user.id,
      after: { name: user.name, email: user.email, role: user.role, locations: data.locations },
      requestId: ctx.requestId,
    });
    return user;
  });
}

export async function updateUser(actor: AccessUser, id: string, input: UpdateUserInput, ctx: Ctx) {
  requireAccess(actor, "settings.manage");
  const patch = parse(updateUserSchema, input);

  if (id === actor.id && (patch.status === "INACTIVE" || (patch.role && patch.role !== "ADMIN"))) {
    throw new ApiError(
      "CONFLICT",
      "You can't deactivate your own account or remove your own admin role. Ask another administrator.",
    );
  }
  if (patch.locations) await assertLocationsExist(patch.locations.map((l) => l.id));

  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id },
      select: { name: true, role: true, status: true, locations: { select: { locationId: true, access: true } } },
    });
    if (!before) throw errors.notFound("user");

    if (patch.locations) {
      await tx.userLocation.deleteMany({ where: { userId: id } });
      await tx.userLocation.createMany({
        data: patch.locations.map((l) => ({ userId: id, locationId: l.id, access: l.access })),
      });
    }
    const user = await tx.user.update({
      where: { id },
      data: { name: patch.name, role: patch.role, status: patch.status },
      select: publicUser,
    });

    // Any change to what this person may do ends their current sessions (§16).
    const privilegeChanged =
      (patch.role !== undefined && patch.role !== before.role) ||
      (patch.status !== undefined && patch.status !== before.status) ||
      patch.locations !== undefined;
    if (privilegeChanged) await deleteUserSessions(id, tx);

    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "user.updated",
      recordType: "user",
      recordId: id,
      before: {
        name: before.name,
        role: before.role,
        status: before.status,
        locations: before.locations.map((l) => ({ id: l.locationId, access: l.access })),
      },
      after: { ...patch, sessionsEnded: privilegeChanged },
      requestId: ctx.requestId,
    });
    return user;
  });
}

/**
 * Admin creates a one-time reset link for a user (valid 1 hour). The raw token
 * is returned once and never stored. Delivery is manual (admin hands the link
 * over) until company email is set up — no passwords are ever sent (§16).
 */
export async function issuePasswordReset(actor: AccessUser, userId: string, ctx: Ctx) {
  requireAccess(actor, "settings.manage");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + RESET_LINK_TTL_MS);
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw errors.notFound("user");
    // Only the newest link works.
    await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.create({
      data: { userId, tokenHash: sha256(token), expiresAt, createdById: actor.id },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "user.password_reset_issued",
      recordType: "user",
      recordId: userId,
      after: { expiresAt: expiresAt.toISOString() },
      requestId: ctx.requestId,
    });
  });
  return { token, expiresAt };
}

export async function resetPasswordWithToken(token: string, password: string, ctx: Ctx) {
  const data = parse(resetPasswordSchema, { token, password });
  const passwordHash = await hashPassword(data.password);
  await prisma.$transaction(async (tx) => {
    const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(data.token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(
        "NOT_FOUND",
        "This reset link has expired or was already used. Ask your administrator for a new one.",
      );
    }
    // Claim the token atomically so two submissions can't both succeed.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ApiError(
        "NOT_FOUND",
        "This reset link has expired or was already used. Ask your administrator for a new one.",
      );
    }
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await deleteUserSessions(row.userId, tx);
    await writeAudit(tx, {
      actorId: row.userId,
      eventType: "user.password_reset_completed",
      recordType: "user",
      recordId: row.userId,
      requestId: ctx.requestId,
    });
  });
}
