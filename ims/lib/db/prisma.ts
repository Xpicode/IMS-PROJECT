import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One client per process (and across hot reloads in development), created on
// first use: `next build` imports server modules without a database, so creating
// it at import time would fail the production image build.
const globalForPrisma = globalThis as unknown as { __imsPrisma?: PrismaClient };
function client(): PrismaClient {
  return (globalForPrisma.__imsPrisma ??= createClient());
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const v = Reflect.get(c, prop, c);
    return typeof v === "function" ? v.bind(c) : v;
  },
});

export { Prisma };
