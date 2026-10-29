import { NoAccess } from "@/components/common/no-access";
import { DocumentsList } from "@/components/documents/documents-list";
import { pageAccess } from "@/lib/auth/page";
import { listDocuments, type DocType } from "@/lib/documents/service";
import { one } from "@/lib/inventory/page-data";

export const metadata = { title: "Documents" };
const TYPES: DocType[] = ["STOCK_ISSUANCE", "TRANSMITTAL", "EQUIPMENT_BORROWING", "RETURN_ACKNOWLEDGMENT"];
const STATUSES = ["READY", "PDF_FAILED", "PENDING"] as const;

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const { user, allowed } = await pageAccess("documents.download");
  if (!allowed) return <NoAccess what="Documents" />;
  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 40) ?? "";
  const type = TYPES.find((t) => t === one(sp.type));
  const status = STATUSES.find((s) => s === one(sp.status));
  const list = await listDocuments(user, { q, type, status, page: Math.max(1, Number(one(sp.page)) || 1) });
  // Link each document back to its record.
  const loanOfReturn = new Map<string, string>();
  const returnIds = list.rows.filter((r) => r.sourceType === "asset_return").map((r) => r.sourceId);
  if (returnIds.length) {
    const { prisma } = await import("@/lib/db/prisma");
    for (const r of await prisma.assetReturn.findMany({
      where: { id: { in: returnIds } },
      select: { id: true, borrowingId: true },
    }))
      loanOfReturn.set(r.id, r.borrowingId);
  }
  const source = (r: (typeof list.rows)[number]) =>
    r.sourceType === "borrowing"
      ? `/borrowing/${r.sourceId}`
      : r.sourceType === "asset_return" && loanOfReturn.get(r.sourceId)
        ? `/borrowing/${loanOfReturn.get(r.sourceId)}`
        : null;
  return (
    <DocumentsList
      q={q}
      type={type ?? ""}
      status={status ?? ""}
      page={list.page}
      pageCount={list.pageCount}
      total={list.total}
      rows={list.rows.map((r) => ({
        id: r.id,
        type: r.type,
        reference: r.reference,
        status: r.status,
        pageCount: r.pageCount,
        createdAt: r.createdAt.toISOString(),
        location: r.location.code,
        createdBy: r.createdBy.name,
        source: source(r),
        lastError: r.lastError,
      }))}
    />
  );
}
