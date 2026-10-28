"use client";

import Link from "next/link";
import { Wrench } from "lucide-react";
import { DataList, type Column } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { CONDITION } from "@/lib/assets/labels";

export type AssetRow = {
  id: string;
  tag: string;
  serialNumber: string | null;
  status: "AVAILABLE" | "BORROWED" | "UNDER_MAINTENANCE" | "NEEDS_REVIEW" | "LOST" | "RETIRED";
  condition: "GOOD" | "FAIR" | "DAMAGED";
  custodianName: string | null;
  item: { sku: string; name: string };
  location: { code: string; name: string };
};

export function AssetsList({
  rows,
  page,
  pageCount,
  baseQuery,
  filtered,
}: {
  rows: AssetRow[];
  page: number;
  pageCount: number;
  baseQuery: string;
  filtered: boolean;
}) {
  const columns: Column<AssetRow>[] = [
    {
      key: "tag",
      header: "Asset",
      primary: true,
      cell: (a) => (
        <Link href={`/assets/${a.id}`} className="block underline-offset-4 hover:underline">
          <span className="block font-medium">{a.tag}</span>
          <span className="block text-sm font-normal text-muted-foreground">{a.item.name}</span>
        </Link>
      ),
    },
    { key: "serial", header: "Serial", cell: (a) => a.serialNumber ?? "—" },
    { key: "loc", header: "Location", cell: (a) => a.location.code },
    { key: "who", header: "Custodian", cell: (a) => a.custodianName ?? "—", hideOnCard: true },
    { key: "cond", header: "Condition", cell: (a) => CONDITION[a.condition] },
    { key: "status", header: "Status", cell: (a) => <StatusChip kind="asset" status={a.status} /> },
  ];
  return (
    <DataList
      rows={rows}
      columns={columns}
      rowKey={(a) => a.id}
      label="Assets"
      empty={
        filtered
          ? { title: "No assets match", description: "Try another word or status.", icon: Wrench }
          : {
              title: "No assets yet",
              description: "Add assets from an asset item, like 5 drills that each get their own tag.",
              icon: Wrench,
            }
      }
      pagination={{ page, pageCount, href: (p) => `/assets?${baseQuery}${baseQuery ? "&" : ""}page=${p}` }}
    />
  );
}
