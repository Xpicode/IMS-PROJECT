import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoAccess } from "@/components/common/no-access";
import { PageHeader } from "@/components/common/page-header";
import { AuditList } from "@/components/admin/audit-list";
import { pageAccess } from "@/lib/auth/page";
import { prisma } from "@/lib/db/prisma";
import { one } from "@/lib/inventory/page-data";
import { auditEventTypes, listAudit } from "@/lib/audit/viewer";
import { formatDateTime } from "@/lib/format";
import { pageSizeParam } from "@/lib/paging";

export const metadata = { title: "Audit log" };
const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Record types that have their own page. */
const PAGES: Record<string, (id: string) => string> = {
  borrowing: (id) => `/borrowing/${id}`,
  asset: (id) => `/assets/${id}`,
  item: (id) => `/stock/items/${id}`,
  count_session: (id) => `/counts/${id}`,
};
const select = "h-12 w-full rounded-md border border-input bg-background px-3 text-base";

export default async function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  const { user, allowed } = await pageAccess("settings.manage");
  if (!allowed) return <NoAccess what="the audit log" />;
  const sp = await searchParams;
  const v = {
    view: one(sp.view) === "all" ? ("all" as const) : ("important" as const),
    userId: UUID.test(one(sp.userId) ?? "") ? one(sp.userId) : undefined,
    eventType: one(sp.eventType)?.slice(0, 80) || undefined,
    recordId: one(sp.recordId)?.trim().slice(0, 64) || undefined,
    from: DAY.test(one(sp.from) ?? "") ? one(sp.from) : undefined,
    to: DAY.test(one(sp.to) ?? "") ? one(sp.to) : undefined,
  };
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const size = pageSizeParam(sp.size);
  const sizeQuery = one(sp.size) === "all" ? "all" : String(size);
  const [list, users, types] = await Promise.all([
    listAudit(user, { ...v, page, pageSize: size }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    auditEventTypes(),
  ]);
  const qs = new URLSearchParams(Object.entries(v).filter((e): e is [string, string] => !!e[1]));
  qs.set("view", list.view);
  qs.set("size", sizeQuery);
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what, and when. All activity is still recorded in the full, append-only audit log. Important events hides routine activity from this display only."
      />
      <form method="get" className="mb-4 grid gap-3 surface p-4 sm:grid-cols-3">
        <input type="hidden" name="size" value={sizeQuery} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-view">View</Label>
          <select key={list.view} id="a-view" name="view" defaultValue={list.view} className={select}>
            <option value="important">Important events</option>
            <option value="all">All events</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-from">From date</Label>
          <Input id="a-from" name="from" type="date" defaultValue={v.from ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-to">To date</Label>
          <Input id="a-to" name="to" type="date" defaultValue={v.to ?? ""} />
        </div>
        <details className="sm:col-span-3" open={!!(v.userId || v.eventType || v.recordId)}>
          <summary className="cursor-pointer text-sm text-primary">More filters</summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Selecting an event family or record ID automatically uses All events, including routine activity.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-user">By</Label>
              <select id="a-user" name="userId" defaultValue={v.userId ?? ""} className={select}>
                <option value="">Anyone</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-type">Event family</Label>
              <select id="a-type" name="eventType" defaultValue={v.eventType ?? ""} className={select}>
                <option value="">Any event family</option>
                {[...new Set([...types, ...(v.eventType ? [v.eventType] : [])])].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-rec">Record ID</Label>
              <Input id="a-rec" name="recordId" type="search" defaultValue={v.recordId ?? ""} autoComplete="off" />
            </div>
          </div>
        </details>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <Button type="submit">
            <Search aria-hidden /> Show
          </Button>
          <Button asChild variant="outline">
            <Link href="/settings/audit">Clear filters</Link>
          </Button>
        </div>
      </form>
      {(v.eventType || v.recordId) && (
        <p className="mb-3 text-sm text-muted-foreground">
          All events is active for this event-family or record investigation, including routine activity.
        </p>
      )}
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        {list.total.toLocaleString("en-PH")} event{list.total === 1 ? "" : "s"}
      </p>
      <AuditList
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
        href={`/settings/audit${qs.size ? `?${qs}` : ""}`}
        rows={list.rows.map((r) => ({
          id: r.id,
          when: formatDateTime(r.createdAt),
          who: r.actor?.name ?? "System",
          eventType: r.eventType,
          record: [r.recordType, r.recordId].filter(Boolean).join(" · ") || "—",
          recordHref:
            r.recordType && r.recordId && UUID.test(r.recordId) && PAGES[r.recordType]
              ? PAGES[r.recordType](r.recordId)
              : null,
          details:
            r.before || r.after
              ? JSON.stringify(
                  { ...(r.before ? { before: r.before } : {}), ...(r.after ? { after: r.after } : {}) },
                  null,
                  2,
                )
              : "",
          requestId: r.requestId,
        }))}
      />
    </>
  );
}
