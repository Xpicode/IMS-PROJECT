/**
 * Create the first administrator on a fresh production database (no demo seed
 * there, §15.5). Safe to re-run: does nothing if an active admin exists.
 *
 *   docker compose run --rm migrate npx tsx scripts/create-admin.ts
 *
 * Reads ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD from the environment
 * (pass them with -e for this one command; don't store the password in files).
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const name = (process.env.ADMIN_NAME ?? "").trim();
const password = process.env.ADMIN_PASSWORD ?? "";

async function main() {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) throw new Error("Set ADMIN_EMAIL and ADMIN_NAME.");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const existing = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
    if (existing > 0) {
      console.log(`An active administrator already exists (${existing}). Nothing changed.`);
      return;
    }
    const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const u = await prisma.user.create({ data: { email, name, role: "ADMIN", status: "ACTIVE", passwordHash } });
    await prisma.auditEvent.create({
      data: {
        actorId: null,
        eventType: "user.created",
        recordType: "user",
        recordId: u.id,
        after: { email, role: "ADMIN", via: "create-admin script" },
      },
    });
    console.log(`Administrator ${email} created. Sign in and change nothing else here.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
