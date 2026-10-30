import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Printer, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoAccess } from "@/components/common/no-access";
import { PageHeader } from "@/components/common/page-header";
import { StatusChip } from "@/components/common/status-chip";
import { EmptyState } from "@/components/common/empty-state";
import { ItemPhoto } from "@/components/inventory/item-photo";
import { pageAccess } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { getItem } from "@/lib/inventory/items";
import { ApiError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Item" };

const TYPE = { RECEIPT: "Received", ISSUE: "Issued", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment" } as const;

export default async function ItemPage({ params }: PageProps<"/stock/items/[id]">) {
  const { user, allowed } = await pageAccess("records.view");
  if (!allowed || user.role === "FIELD") return <NoAccess what="Stock" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const item = await getItem(user, id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const isStock = item.trackingType === "STOCK";
  const canMove = isStock && can(user, "stock.move");

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link
          href="/stock"
          className="inline-block py-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Stock
        </Link>{" "}
        / {item.sku}
      </nav>
      <PageHeader
        title={item.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{item.sku}</span>·<span>{item.category?.name ?? "No category"}</span>·
            <span>{isStock ? `Counted in ${item.unit.code}` : "Tagged assets"}</span>
            {item.stockStatus && <StatusChip kind="stock" status={item.stockStatus} />}
            {!item.isActive && <StatusChip kind="location" status="INACTIVE" />}
          </span>
        }
        actions={
          <>
            {canMove && (
              <>
                <Button asChild>
                  <Link href={`/stock/receive?item=${item.id}`}>
                    <ArrowDownToLine aria-hidden /> Receive
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/stock/issue?item=${item.id}`}>
                    <ArrowUpFromLine aria-hidden /> Issue
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/stock/transfer?item=${item.id}`}>
                    <ArrowLeftRight aria-hidden /> Transfer
                  </Link>
                </Button>
              </>
            )}
            {!isStock && item.canManage && (
              <Button asChild>
                <Link href={`/assets/new?item=${item.id}`}>
                  <Wrench aria-hidden /> Add assets
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={`/labels?type=item&ids=${item.id}`}>
                <Printer aria-hidden /> Print label
              </Link>
            </Button>
          </>
        }
      />
      {item.description && <p className="mb-6 max-w-3xl">{item.description}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <ItemPhoto itemId={item.id} name={item.name} photoPath={item.photoPath} canManage={item.canManage} />
          <section aria-labelledby="bal-h" className="flex flex-col gap-3">
            <h2 id="bal-h" className="text-xl font-semibold">
              {isStock ? "On hand by location" : "Assets"}
            </h2>
            {isStock ? (
              <div className="surface">
                {item.balances.length === 0 ? (
                  <p className="p-4 text-muted-foreground">None at your locations yet. Use Receive to add stock.</p>
                ) : (
                  <ul className="divide-y">
                    {item.balances.map((b) => (
                      <li key={b.location.id} className="flex justify-between gap-3 p-4">
                        <span>
                          <span className="font-medium">{b.location.code}</span>{" "}
                          <span className="text-muted-foreground">{b.location.name}</span>
                        </span>
                        <span className="font-semibold tabular-nums">
                          {b.quantity} {item.unit.code}
                        </span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 bg-muted/50 p-4 font-semibold">
                      <span>Total</span>
                      <span className="tabular-nums">
                        {item.onHand} {item.unit.code}
                      </span>
                    </li>
                  </ul>
                )}
                <p className="border-t p-4 text-sm text-muted-foreground">Low-stock level: {item.minStock}</p>
              </div>
            ) : (
              <div className="surface p-4">
                <p className="text-lg">
                  <b className="tabular-nums">{item.assetCount}</b> tagged at your locations.
                </p>
                <Link
                  href={`/assets?item=${item.id}`}
                  className="mt-2 inline-block font-medium text-primary underline-offset-4 hover:underline"
                >
                  See the assets
                </Link>
              </div>
            )}
            {item.identifiers.length > 0 && (
              <div className="surface p-4">
                <h3 className="font-semibold">Other codes</h3>
                <ul className="mt-1 text-muted-foreground">
                  {item.identifiers.map((x) => (
                    <li key={x.id}>
                      {x.code}{" "}
                      <span className="text-sm">({x.namespace === "MFR" ? "manufacturer barcode" : x.namespace})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        {isStock && (
          <section aria-labelledby="mov-h" className="flex min-w-0 flex-col gap-3">
            <h2 id="mov-h" className="text-xl font-semibold">
              Movements
            </h2>
            {item.movements.length === 0 ? (
              <EmptyState
                title="No movements yet"
                description="Receipts, issues, and transfers of this item will be listed here."
              />
            ) : (
              <ol className="flex flex-col divide-y surface" aria-label="Movements, newest first">
                {item.movements.map((m) => {
                  const t = m.transaction;
                  const who =
                    t.type === "ISSUE"
                      ? `to ${t.recipientName}`
                      : t.type === "RECEIPT" && t.source
                        ? `from ${t.source}`
                        : (t.reason ?? "");
                  return (
                    <li key={m.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {TYPE[t.type]} · {t.reference}
                        </p>
                        <p className="text-sm break-words text-muted-foreground">
                          {formatDateTime(m.createdAt)} · {m.location.code} · by {t.actor.name}
                          {who && ` · ${who}`}
                        </p>
                      </div>
                      <p className="shrink-0 tabular-nums sm:text-right">
                        <b className={m.quantity < 0 ? "text-danger" : "text-success"}>
                          {m.quantity > 0 ? "+" : "−"}
                          {Math.abs(m.quantity)}
                        </b>{" "}
                        <span className="text-muted-foreground">→ {m.balanceAfter}</span>
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </div>
    </>
  );
}
