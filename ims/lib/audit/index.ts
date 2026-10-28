import "server-only";
import type { Db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";

export type AuditInput = {
  actorId: string | null;
  /** dotted, past tense: "user.created", "location.updated", "auth.forbidden" */
  eventType: string;
  recordType?: string;
  recordId?: string;
  /** Safe details only. Never passwords, hashes, tokens, or full documents. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string;
};

const SECRET_KEYS = /pass(word)?|hash|token|secret/i;

function scrub(v: Record<string, unknown> | null | undefined) {
  if (!v) return Prisma.DbNull;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) if (!SECRET_KEYS.test(k)) out[k] = val;
  return out as Prisma.InputJsonObject;
}

/**
 * Append one audit event. Pass the transaction client so the audit row commits
 * (or rolls back) together with the change it describes.
 */
export function writeAudit(db: Db, e: AuditInput) {
  return db.auditEvent.create({
    data: {
      actorId: e.actorId,
      eventType: e.eventType,
      recordType: e.recordType,
      recordId: e.recordId,
      before: scrub(e.before),
      after: scrub(e.after),
      requestId: e.requestId,
    },
  });
}
