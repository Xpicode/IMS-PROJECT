import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { __imsPrisma?: PrismaClient };
export const prisma = globalForPrisma.__imsPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__imsPrisma = prisma;

export { Prisma };
