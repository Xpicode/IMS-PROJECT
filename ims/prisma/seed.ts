/**
 * Demo data for local development and testing ONLY (§15.5).
 * Safe to run repeatedly (upserts). Refuses to run in production.
 *
 *   npx prisma db seed
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "yes") {
  console.error("Refusing to seed demo users in production.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const password = process.env.SEED_PASSWORD || "Demo-Password-2026";

async function main() {
  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });

  const loc = async (code: string, name: string, type: "WAREHOUSE" | "SITE" | "AREA") =>
    prisma.location.upsert({ where: { code }, update: {}, create: { code, name, type } });
  const main = await loc("MAIN-WH", "Main Warehouse", "WAREHOUSE");
  const siteB = await loc("SITE-B", "Site B", "SITE");
  const workshop = await loc("WORKSHOP", "Workshop", "AREA");

  const user = async (
    email: string,
    name: string,
    role: "ADMIN" | "SUPERVISOR" | "FIELD",
    locationIds: string[],
  ) => {
    const u = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, role, passwordHash },
    });
    for (const locationId of locationIds) {
      await prisma.userLocation.upsert({
        where: { userId_locationId: { userId: u.id, locationId } },
        update: {},
        create: { userId: u.id, locationId, access: "FULL" },
      });
    }
    return u;
  };
  await user("admin@ims.local", "Alex Admin", "ADMIN", []);
  await user("supervisor@ims.local", "Sam Supervisor", "SUPERVISOR", [main.id, workshop.id]);
  await user("field@ims.local", "Juan Dela Cruz", "FIELD", [siteB.id]);

  console.log("Seeded 3 locations and 3 demo users (admin@, supervisor@, field@ims.local).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
