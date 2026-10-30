"use client";

import Link from "next/link";
import { useState } from "react";
import { ImageOff, Package, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataList, type Column } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { itemPhotoUrl } from "@/lib/photo";
import { ItemForm, type CatalogOptions } from "./item-form";

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
  baseQuery,
  canManage,
  catalog,
  filtered,
}: {
  rows: ItemListRow[];
  page: number;
  pageCount: number;
  baseQuery: string;
  canManage: boolean;
  catalog: CatalogOptions;
  filtered: boolean;
}) {
  const [adding, setAdding] = useState(false);
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
        label="Items"
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
        pagination={{ page, pageCount, href: (p) => `/stock?${baseQuery}${baseQuery ? "&" : ""}page=${p}` }}
      />
      {canManage && <ItemForm open={adding} onOpenChange={setAdding} catalog={catalog} />}
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
