import Link from "next/link";
import { Printer, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoAccess } from "@/components/common/no-access";
import { PageHeader } from "@/components/common/page-header";
import { AssetsList } from "@/components/assets/assets-list";
import { pageAccess } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { listAssets } from "@/lib/assets/service";
import { one } from "@/lib/inventory/page-data";

export const metadata = { title: "Assets" };

const STATUSES = [
  ["", "All statuses"],
  ["AVAILABLE", "Available"],
  ["BORROWED", "Borrowed"],
  ["UNDER_MAINTENANCE", "Under maintenance"],
  ["NEEDS_REVIEW", "Needs review"],
  ["LOST", "Lost"],
  ["RETIRED", "Retired"],
] as const;

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const { user, allowed } = await pageAccess("records.view");
  if (!allowed || user.role === "FIELD") return <NoAccess what="Assets" />;
  const sp = await searchParams;
  const q = one(sp.q)?.trim().slice(0, 100) ?? "";
  const status = STATUSES.some(([k]) => k && k === one(sp.status)) ? one(sp.status)! : "";
  const itemId = /^[0-9a-f-]{36}$/i.test(one(sp.item) ?? "") ? one(sp.item)! : "";
  const page = Number(one(sp.page)) || 1;
  const r = await listAssets(user, {
    q: q || undefined,
    status: status || undefined,
    itemId: itemId || undefined,
    page,
  });
  const base = new URLSearchParams(Object.entries({ q, status, item: itemId }).filter(([, v]) => v)).toString();

  return (
    <>
      <PageHeader
        title="Assets"
        description="Tools and equipment tracked one by one, each with its own tag."
        actions={
          <>
            {can(user, "masterData.manage") && (
              <Button asChild>
                <Link href="/assets/new">
                  <Wrench aria-hidden /> Add assets
                </Link>
              </Button>
            )}
            {r.rows.length > 0 && (
              <Button asChild variant="outline">
                <Link href={`/labels?type=asset&ids=${r.rows.map((a) => a.id).join(",")}`}>
                  <Printer aria-hidden /> Print labels for this page
                </Link>
              </Button>
            )}
          </>
        }
      />
      <form action="/assets" role="search" className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="assets-q" className="text-sm font-medium">
            Search
          </label>
          <input
            id="assets-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Tag, serial, or item name"
            className="h-12 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:w-56">
          <label htmlFor="assets-status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="assets-status"
            name="status"
            defaultValue={status}
            className="h-12 rounded-lg border border-input bg-card px-3 text-base"
          >
            {STATUSES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {itemId && <input type="hidden" name="item" value={itemId} />}
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
        {r.total} {r.total === 1 ? "asset" : "assets"}
        {itemId && r.rows[0] ? ` of ${r.rows[0].item.name}` : ""}
      </p>
      <AssetsList
        rows={r.rows}
        page={r.page}
        pageCount={r.pageCount}
        baseQuery={base}
        filtered={!!(q || status || itemId)}
      />
    </>
  );
}
