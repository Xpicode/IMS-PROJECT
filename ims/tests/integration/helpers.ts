import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import type { Role } from "@/lib/permissions";

/** Empty every table. TRUNCATE skips the audit append-only row trigger. */
export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export const TEST_PASSWORD = "Correct-Horse-9";
let pwHash: string | undefined;

export async function makeUser(
  role: Role,
  locations: { id: string; access?: "FULL" | "VIEW_ONLY" }[] = [],
  overrides: { email?: string; status?: "ACTIVE" | "INACTIVE" } = {},
) {
  pwHash ??= await hashPassword(TEST_PASSWORD);
  return prisma.user.create({
    data: {
      name: `${role} ${randomUUID().slice(0, 6)}`,
      email: overrides.email ?? `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@test.local`,
      passwordHash: pwHash,
      role,
      status: overrides.status ?? "ACTIVE",
      locations: { create: locations.map((l) => ({ locationId: l.id, access: l.access ?? "FULL" })) },
    },
  });
}

export async function makeLocation(
  code: string,
  type: "WAREHOUSE" | "SITE" | "AREA" = "WAREHOUSE",
  parentId?: string,
) {
  return prisma.location.create({ data: { code, name: code + " name", type, parentId } });
}

export const ctx = () => ({ requestId: randomUUID() });
