import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoAccess } from "@/components/common/no-access";
import { PageHeader } from "@/components/common/page-header";
import { AddItemButton, ItemsList } from "@/components/inventory/items-list";
import { pageAccess } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { listCatalog, listItems } from "@/lib/inventory/items";
import { one } from "@/lib/inventory/page-data";
import { cn } from "@/lib/utils";

export const metadata = { title: "Stock" };

const FILTERS = [
  { key: "", label: "All" },
  { key: "low", label: "Low" },
  { key: "out", label: "Out" },
] as const;

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  const { user, allowed } = await pageAccess("records.view");
  if (!allowed || user.role === "FIELD") return <NoAccess what="Stock" />;
  const sp = await searchParams;
  const q = one(sp.q)?.trim().slice(0, 100) ?? "";
  const stock = one(sp.stock) === "low" || one(sp.stock) === "out" ? (one(sp.stock) as "low" | "out") : undefined;
  const categoryId = one(sp.category) ?? "";
  const page = Number(one(sp.page)) || 1;

  const [items, catalog] = await Promise.all([
    listItems(user, {
      q: q || undefined,
      stock,
      categoryId: /^[0-9a-f-]{36}$/i.test(categoryId) ? categoryId : undefined,
      page,
    }),
    listCatalog(user),
  ]);
  const canMove = can(user, "stock.move");
  const canManage = can(user, "masterData.manage");
  const qs = (o: Record<string, string | undefined>) =>
    new URLSearchParams(
      Object.entries({ q: q || undefined, stock, category: categoryId || undefined, ...o }).filter(([, v]) => v) as [
        string,
        string,
      ][],
    ).toString();
  const catalogOpts = {
    units: catalog.units.filter((u) => u.isActive).map((u) => ({ id: u.id, code: u.code, name: u.name })),
    categories: catalog.categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name })),
  };

  return (
    <>
      <PageHeader
        title="Stock"
        description="Items and how many are on hand at your locations."
        actions={
          <>
            {canMove && (
              <>
                <Button asChild>
                  <Link href="/stock/receive">
                    <ArrowDownToLine aria-hidden /> Receive
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/stock/issue">
                    <ArrowUpFromLine aria-hidden /> Issue
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/stock/transfer">
                    <ArrowLeftRight aria-hidden /> Transfer
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <form action="/stock" role="search" className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="stock-q" className="text-sm font-medium">
              Search
            </label>
            <input
              id="stock-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Name, SKU, or scan a barcode"
              className="h-12 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:w-48">
            <label htmlFor="stock-cat" className="text-sm font-medium">
              Category
            </label>
            <select
              id="stock-cat"
              name="category"
              defaultValue={categoryId}
              className="h-12 rounded-lg border border-input bg-card px-3 text-base"
            >
              <option value="">All categories</option>
              {catalog.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {stock && <input type="hidden" name="stock" value={stock} />}
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <nav aria-label="Stock level filter" className="flex gap-2">
          {FILTERS.map((f) => {
            const active = (stock ?? "") === f.key;
            return (
              <Link
                key={f.key}
                href={`/stock?${qs({ stock: f.key || undefined })}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-12 items-center rounded-full border px-4 font-medium",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {canManage && (
        <div className="mb-4 flex flex-wrap gap-2">
          <AddItemButton catalog={catalogOpts} />
          <Button asChild variant="outline">
            <Link href="/stock/import">
              <Upload aria-hidden /> Import CSV
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/v1/items/export" download>
              <Download aria-hidden /> Export CSV
            </a>
          </Button>
        </div>
      )}
      <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
        {items.total} {items.total === 1 ? "item" : "items"}
      </p>
      <ItemsList
        rows={items.rows}
        page={items.page}
        pageCount={items.pageCount}
        baseQuery={qs({})}
        canManage={canManage}
        catalog={catalogOpts}
        filtered={!!(q || stock || categoryId)}
      />
    </>
  );
}
