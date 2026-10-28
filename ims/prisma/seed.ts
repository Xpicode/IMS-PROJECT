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

  const user = async (email: string, name: string, role: "ADMIN" | "SUPERVISOR" | "FIELD", locationIds: string[]) => {
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

  await seedCatalog(main.id, siteB.id, workshop.id);
  console.log("Seeded 3 locations and 3 demo users (admin@, supervisor@, field@ims.local).");
}

/** Labeled sample catalog + opening stock. Runs only while there are no items yet. */
async function seedCatalog(mainId: string, siteBId: string, workshopId: string) {
  if ((await prisma.item.count()) > 0) return;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@ims.local" } });
  const unit = async (code: string, name: string) =>
    prisma.unit.upsert({ where: { code }, update: {}, create: { code, name } });
  const cat = async (name: string) => prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  const [pcs, pair, pack, box, roll] = await Promise.all([
    unit("pcs", "Piece"),
    unit("pair", "Pair"),
    unit("pack", "Pack"),
    unit("box", "Box"),
    unit("roll", "Roll"),
  ]);
  const [ppe, elec, tools, it] = await Promise.all([cat("PPE"), cat("Electrical"), cat("Tools"), cat("IT equipment")]);
  const NOTE = "Sample data (seed). Replace with the real inventory export.";
  const item = (
    sku: string,
    name: string,
    unitId: string,
    categoryId: string,
    trackingType: "STOCK" | "ASSET",
    minStock = 0,
  ) => prisma.item.create({ data: { sku, name, unitId, categoryId, trackingType, minStock, description: NOTE } });
  const gloves = await item("PPE-0001", "Safety Gloves", pair.id, ppe.id, "STOCK", 20);
  const hats = await item("PPE-0002", "Hard Hat", pcs.id, ppe.id, "STOCK", 5);
  const ties = await item("ELC-0042", "Cable Ties 200mm", pack.id, elec.id, "STOCK", 10);
  const tape = await item("ELC-0051", "Electrical Tape", roll.id, elec.id, "STOCK", 12);
  const fittings = await item("PLB-0007", "Pipe Fittings 1/2in", box.id, tools.id, "STOCK", 4);
  const drill = await item("TOOL-DRILL", "Cordless Drill", pcs.id, tools.id, "ASSET");
  await item("IT-LAPTOP", "Laptop", pcs.id, it.id, "ASSET");

  // Opening stock as one confirmed receipt per location, so the ledger matches the balances.
  const year = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: process.env.NEXT_PUBLIC_COMPANY_TIMEZONE || "Asia/Manila",
      year: "numeric",
    }).format(new Date()),
  );
  let n = 0;
  const receive = async (locationId: string, lines: [string, number][]) => {
    n++;
    await prisma.stockTransaction.create({
      data: {
        reference: `RCV-${year}-${String(n).padStart(6, "0")}`,
        type: "RECEIPT",
        source: "Opening balance (sample data)",
        actorId: admin.id,
        movements: {
          create: lines.map(([itemId, quantity]) => ({ itemId, locationId, quantity, balanceAfter: quantity })),
        },
      },
    });
    await prisma.stockBalance.createMany({
      data: lines.map(([itemId, quantity]) => ({ itemId, locationId, quantity })),
    });
  };
  await receive(mainId, [
    [gloves.id, 120],
    [hats.id, 4],
    [ties.id, 40],
    [tape.id, 30],
    [fittings.id, 9],
  ]);
  await receive(siteBId, [
    [gloves.id, 40],
    [ties.id, 6],
  ]);
  await prisma.documentSequence.create({ data: { docType: "RCV", year, next: n + 1 } });

  const drills: [string, string, string][] = [
    ["TOOL-0001", "MFG-821", mainId],
    ["TOOL-0002", "MFG-822", mainId],
    ["TOOL-0003", "MFG-823", workshopId],
  ];
  for (const [tag, serialNumber, locationId] of drills) {
    await prisma.asset.create({
      data: {
        tag,
        serialNumber,
        locationId,
        itemId: drill.id,
        notes: NOTE,
        events: {
          create: {
            eventType: "CREATED",
            toStatus: "AVAILABLE",
            toLocationId: locationId,
            toCondition: "GOOD",
            notes: NOTE,
            actorId: admin.id,
          },
        },
      },
    });
  }
  await prisma.documentSequence.create({ data: { docType: "TAG:TOOL", year: 0, next: 4 } });
  console.log("Seeded sample catalog: 5 units, 4 categories, 7 items, opening stock, 3 drills.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
