import "server-only";
import { z } from "zod";
import { prisma, Prisma } from "@/lib/db/prisma";
import { requireAccess, type AccessUser } from "@/lib/permissions";

/**
 * Audit log viewer (BUILD_PLAN Phase 6). Admins only: audit events are not tied
 * to a location, so a supervisor-scoped view would show other sites' activity.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  userId: z.uuid().optional(),
  eventType: z.string().trim().max(80).optional(),
  recordType: z.string().trim().max(60).optional(),
  recordId: z.string().trim().max(64).optional(),
  from: day.optional(),
  to: day.optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type AuditFilters = z.input<typeof schema>;
const TZ = "+08:00";
const PAGE = 50;

export async function listAudit(actor: AccessUser, input: AuditFilters) {
  requireAccess(actor, "settings.manage");
  const f = schema.parse(input);
  const page = f.page ?? 1;
  const where: Prisma.AuditEventWhereInput = {
    ...(f.userId ? { actorId: f.userId } : {}),
    ...(f.eventType ? { eventType: { startsWith: f.eventType } } : {}),
    ...(f.recordType ? { recordType: f.recordType } : {}),
    ...(f.recordId ? { recordId: f.recordId } : {}),
    ...(f.from || f.to
      ? {
          createdAt: {
            ...(f.from ? { gte: new Date(`${f.from}T00:00:00${TZ}`) } : {}),
            ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999${TZ}`) } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.auditEvent.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE)) };
}

/** Distinct event families for the filter ("borrowing", "stock", …). */
export async function auditEventTypes() {
  const r = await prisma.$queryRaw<{ t: string }[]>`
    SELECT DISTINCT split_part(event_type, '.', 1) AS t FROM audit_events ORDER BY 1 LIMIT 100`;
  return r.map((x) => x.t);
}
