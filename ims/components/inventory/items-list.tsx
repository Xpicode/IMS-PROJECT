"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, MinusCircle, Package, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataList, type Column } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { itemPhotoUrl } from "@/lib/photo";
import { runBulkDelete } from "@/lib/bulk-delete-client";
import { ItemForm, type CatalogOptions } from "./item-form";
import { UseStockDialog, type UseLocation } from "./use-stock";

export type ItemListRow = {
  id: string;
  sku: string;
  name: string;
  trackingType: "STOCK" | "ASSET";
  categoryName: string | null;
  unitCode: string;
  onHand: number;
  assetCount: number;
  stockStatus: "OK" | "LOW" | "OUT" | null;
  isActive: boolean;
  photoPath: string | null;
};

export function ItemsList({
  rows,
  page,
  pageCount,
  total,
  baseQuery,
  canManage,
  catalog,
  filtered,
  useLocations,
  userName,
}: {
  rows: ItemListRow[];
  page: number;
  pageCount: number;
  total: number;
  baseQuery: string;
  canManage: boolean;
  catalog: CatalogOptions;
  filtered: boolean;
  /** Where this person may take stock out ("Use"); empty = no Use action. */
  useLocations: UseLocation[];
  userName: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [using, setUsing] = useState<ItemListRow | null>(null);
  const columns: Column<ItemListRow>[] = [
    {
      key: "item",
      header: "Item",
      primary: true,
      cell: (r) => (
        <Link href={`/stock/items/${r.id}`} className="flex items-center gap-3 underline-offset-4 hover:underline">
          {r.photoPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, signed-in image from our API
            <img
              src={itemPhotoUrl(r.id, r.photoPath)}
              alt=""
              loading="lazy"
              className="size-11 shrink-0 rounded-md border bg-muted object-cover"
            />
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <ImageOff className="size-4" aria-hidden />
            </span>
          )}
          <span className="min-w-0">
            <span className="block font-medium">{r.name}</span>
            <span className="block text-sm font-normal text-muted-foreground">{r.sku}</span>
          </span>
        </Link>
      ),
    },
    { key: "cat", header: "Category", cell: (r) => r.categoryName ?? "—" },
    {
      key: "qty",
      header: "On hand",
      align: "right",
      cell: (r) =>
        r.trackingType === "STOCK" ? (
          <span className="tabular-nums">
            {r.onHand} {r.unitCode}
          </span>
        ) : (
          <span className="tabular-nums">{r.assetCount} tagged</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) =>
        r.stockStatus ? (
          <StatusChip kind="stock" status={r.stockStatus} />
        ) : (
          <span className="text-muted-foreground">Asset item</span>
        ),
    },
  ];
  return (
    <>
      <DataList
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.sku}
        label="Items"
        actions={(r) =>
          r.trackingType === "STOCK" && useLocations.length > 0
            ? [{ label: "Use", icon: MinusCircle, onSelect: () => setUsing(r), disabled: r.onHand <= 0 }]
            : []
        }
        bulkDelete={
          canManage
            ? {
                noun: "items",
                note: "Items never used are deleted. Items with stock moves, assets or counts are hidden instead, so their history and forms stay correct.",
                onDelete: async (ids) => {
                  await runBulkDelete("items", ids);
                  router.refresh();
                },
              }
            : undefined
        }
        empty={
          filtered
            ? {
                title: "No items match",
                description: "Try another word, or clear the filters.",
                icon: Package,
                action: (
                  <Button asChild variant="outline">
                    <Link href="/stock">Clear filters</Link>
                  </Button>
                ),
              }
            : {
                title: "No items yet",
                description: "Add your first item, or import a CSV file of your current inventory.",
                icon: Package,
                action: canManage ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => setAdding(true)}>
                      <PackagePlus aria-hidden /> Add item
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/stock/import">Import CSV</Link>
                    </Button>
                  </div>
                ) : undefined,
              }
        }
        pagination={{ page, pageCount, total, href: (p) => `/stock?${baseQuery}${baseQuery ? "&" : ""}page=${p}` }}
      />
      {canManage && <ItemForm open={adding} onOpenChange={setAdding} catalog={catalog} />}
      {using && (
        <UseStockDialog
          key={using.id}
          item={{ id: using.id, name: using.name, unitCode: using.unitCode }}
          locations={useLocations}
          userName={userName}
          open
          onOpenChange={(o) => !o && setUsing(null)}
        />
      )}
    </>
  );
}

/** Header button that opens the same dialog. */
export function AddItemButton({ catalog }: { catalog: CatalogOptions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PackagePlus aria-hidden /> Add item
      </Button>
      <ItemForm open={open} onOpenChange={setOpen} catalog={catalog} />
    </>
  );
}
