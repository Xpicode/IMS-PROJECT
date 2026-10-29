import { NoAccess } from "@/components/common/no-access";
import { LoansList, type LoanTab } from "@/components/borrowing/loans-list";
import { pageAccess } from "@/lib/auth/page";
import { listBorrowings } from "@/lib/borrowing/service";
import { locationsFor, one } from "@/lib/inventory/page-data";

export const metadata = { title: "Borrowing" };
const TABS: LoanTab[] = ["requests", "active", "overdue", "closed"];

export default async function BorrowingPage({ searchParams }: PageProps<"/borrowing">) {
  const { user, allowed } = await pageAccess("custody.confirm");
  if (!allowed) return <NoAccess what="Borrowing" />;
  const sp = await searchParams;
  const t = one(sp.tab) as LoanTab;
  const tab: LoanTab = TABS.includes(t) ? t : "active";
  const q = one(sp.q)?.slice(0, 60) ?? "";
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [list, locs, ...counts] = await Promise.all([
    listBorrowings(user, { tab, q, page }),
    locationsFor(user, "custody.confirm"),
    ...TABS.map((k) => listBorrowings(user, { tab: k, q }).then((r) => r.total)),
  ]);
  return (
    <LoansList
      tab={tab}
      q={q}
      page={list.page}
      pageCount={list.pageCount}
      canCreate={locs.length > 0}
      counts={Object.fromEntries(TABS.map((k, i) => [k, counts[i]])) as Record<LoanTab, number>}
      rows={list.rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        status: r.status,
        borrowerName: r.borrowerName,
        borrowerDept: r.borrowerDept,
        purpose: r.purpose,
        dueAt: r.dueAt?.toISOString() ?? null,
        releasedAt: r.releasedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        location: r.location.code,
        preparedBy: r.preparedBy.name,
        total: r.total,
        returned: r.returned,
        tags: r.tags,
        overdue: r.overdue,
        canRelease: locs.some((l) => l.code === r.location.code),
      }))}
    />
  );
}
