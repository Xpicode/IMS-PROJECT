import "server-only";
import type { Prisma } from "@/generated/prisma/client";

const TZ = process.env.NEXT_PUBLIC_COMPANY_TIMEZONE || "Asia/Manila";

/** Year in the company timezone, so 1 Jan 00:30 local time starts the new series. */
export const companyYear = (d = new Date()) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric" }).format(d));

/**
 * Reserve the next number in a series inside the caller's transaction. The
 * row lock serializes concurrent confirms; a rollback releases the number, so
 * official references have no gaps (§9.1 document_sequences).
 */
export async function nextNumber(tx: Prisma.TransactionClient, docType: string, year: number) {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    INSERT INTO document_sequences (doc_type, year, next) VALUES (${docType}, ${year}, 2)
    ON CONFLICT (doc_type, year) DO UPDATE SET next = document_sequences.next + 1
    RETURNING next - 1 AS n`;
  return Number(rows[0].n);
}

/** e.g. ISS-2026-000123 (default numbering convention, pending confirmation in Phase 0). */
export async function nextReference(
  tx: Prisma.TransactionClient,
  prefix: "RCV" | "ISS" | "TRN" | "ADJ" | "CNT" | "BOR" | "RET",
) {
  const year = companyYear();
  const n = await nextNumber(tx, prefix, year);
  return `${prefix}-${year}-${String(n).padStart(6, "0")}`;
}
