"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, MapPinPlus, Pencil, Power } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataList, type Column } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { PageHeader } from "@/components/common/page-header";
import { LocationForm, TYPE_LABEL, type EditableLocation, type ParentOption } from "./location-form";
import { apiFetch } from "@/lib/api-client";

export type LocationRow = EditableLocation & {
  isActive: boolean;
  parent: { code: string } | null;
  _count: { users: number; children: number };
  canManage: boolean;
};

export function LocationsList({
  rows,
  parents,
  allowTopLevel,
  query,
}: {
  rows: LocationRow[];
  parents: ParentOption[];
  allowTopLevel: boolean;
  query?: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [toggling, setToggling] = useState<LocationRow | null>(null);
  const canCreate = allowTopLevel || parents.length > 0;
  const anyManage = rows.some((r) => r.canManage);

  const columns: Column<LocationRow>[] = [
    {
      key: "code",
      header: "Location",
      primary: true,
      cell: (l) => (
        <span>
          <span className="block font-medium">{l.code}</span>
          <span className="block text-sm font-normal text-muted-foreground">{l.name}</span>
        </span>
      ),
    },
    { key: "type", header: "Type", cell: (l) => TYPE_LABEL[l.type] },
    { key: "parent", header: "Inside", cell: (l) => l.parent?.code ?? "—" },
    { key: "people", header: "People", align: "right", cell: (l) => <span className="tabular-nums">{l._count.users}</span> },
    { key: "status", header: "Status", cell: (l) => <StatusChip kind="location" status={l.isActive ? "ACTIVE" : "INACTIVE"} /> },
  ];

  return (
    <>
      <PageHeader
        title="Locations"
        description={query ? `Showing locations matching "${query}".` : "Warehouses, sites, and the racks or areas inside them."}
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <MapPinPlus aria-hidden /> Add location
            </Button>
          ) : undefined
        }
      />
      <DataList
        label="Locations"
        rows={rows}
        columns={columns}
        rowKey={(l) => l.id}
        empty={
          query
            ? { icon: MapPin, title: "No matches", description: `No location code or name contains "${query}".` }
            : {
                icon: MapPin,
                title: "No locations yet",
                description: canCreate ? "Add your first warehouse or site." : "Ask an administrator to assign you to a location.",
                action: canCreate ? <Button onClick={() => setCreating(true)}>Add location</Button> : undefined,
              }
        }
        rowLabel={(l) => l.code}
        actions={
          anyManage
            ? (l) =>
                l.canManage
                  ? [
                      { label: "Edit", icon: Pencil, onSelect: () => setEditing(l) },
                      {
                        label: l.isActive ? "Deactivate" : "Reactivate",
                        icon: Power,
                        onSelect: () => setToggling(l),
                        destructive: l.isActive,
                      },
                    ]
                  : []
            : undefined
        }
      />

      {canCreate && <LocationForm open={creating} onOpenChange={setCreating} parents={parents} allowTopLevel={allowTopLevel} />}
      {editing && (
        <LocationForm key={editing.id} open onOpenChange={(o) => !o && setEditing(null)} location={editing} parents={parents} allowTopLevel={allowTopLevel} />
      )}
      <ConfirmSheet
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.isActive ? `Deactivate ${toggling?.code}?` : `Reactivate ${toggling?.code}?`}
        description={
          toggling?.isActive
            ? "It's hidden from new transactions. Its history stays. Locations inside it must be deactivated first."
            : "It can be used in new transactions again."
        }
        changes={toggling ? [{ label: toggling.code, from: toggling.isActive ? "Active" : "Inactive", to: toggling.isActive ? "Inactive" : "Active" }] : []}
        confirmLabel={toggling?.isActive ? "Deactivate location" : "Reactivate location"}
        tone={toggling?.isActive ? "destructive" : "default"}
        onConfirm={async () => {
          const l = toggling!;
          await apiFetch(`/api/v1/locations/${l.id}`, { method: "PATCH", body: { isActive: !l.isActive } });
          toast.success(`${l.code} is ${l.isActive ? "deactivated" : "active again"}.`);
          router.refresh();
        }}
      />
    </>
  );
}
