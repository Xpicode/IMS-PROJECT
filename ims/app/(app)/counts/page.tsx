import { NoAccess } from "@/components/common/no-access";
import { CountsList } from "@/components/counts/counts-list";
import { pageAccess } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { listCountSessions } from "@/lib/counts/service";
import { locationsFor, one } from "@/lib/inventory/page-data";
import { pageSizeParam } from "@/lib/paging";

export const metadata = { title: "Counts" };

export default async function CountsPage({ searchParams }: PageProps<"/counts">) {
  const { user, allowed } = await pageAccess("counts.create");
  if (!allowed) return <NoAccess what="Counts" />;
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [list, locs] = await Promise.all([
    listCountSessions(user, { page, pageSize: pageSizeParam(sp.size) }),
    locationsFor(user, "counts.create"),
  ]);
  return (
    <CountsList
      canCreate={locs.length > 0}
      page={list.page}
      pageCount={list.pageCount}
      total={list.total}
      rows={list.rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        name: r.name,
        status: r.status,
        dueAt: r.dueAt?.toISOString() ?? null,
        location: r.location,
        assignees: r.assignees.map((a) => a.user.name),
        targets: r._count.targets,
        counted: r.progress.counted,
        done: r.progress.done,
        canManage: can(user, "counts.create", r.location.id),
      }))}
    />
  );
}
