import { prisma } from "@/lib/db/prisma";

/** Non-sensitive health check for Docker/NGINX/monitoring. No auth, no details. */
export async function GET() {
  let db = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "down";
  }
  const ok = db === "ok";
  return Response.json(
    { status: ok ? "ok" : "degraded", db, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
