import "server-only";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Prisma loads a query's relations in parallel; inside a transaction they all go to
 * the one connection. pg queues them for us today but deprecates that (removed in
 * pg 9), so queue them here instead: each query waits for the previous one.
 * Callback and stream-style calls keep pg's own handling.
 */
class OneQueryAtATime extends pg.Client {
  #tail: Promise<unknown> = Promise.resolve();
  override query(...args: unknown[]): never {
    const run = () => (pg.Client.prototype.query as (...a: unknown[]) => unknown).apply(this, args);
    const last = args[args.length - 1];
    if (typeof last === "function" || typeof (args[0] as { submit?: unknown })?.submit === "function")
      return run() as never;
    const p = this.#tail.then(run);
    this.#tail = p.catch(() => {});
    return p as never;
  }
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, Client: OneQueryAtATime }) });
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
