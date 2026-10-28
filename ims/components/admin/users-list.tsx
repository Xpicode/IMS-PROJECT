"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Pencil, UserPlus, UserX, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataList, type Column } from "@/components/common/data-list";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { PageHeader } from "@/components/common/page-header";
import { UserForm, type EditableUser } from "./user-form";
import type { LocationOption } from "./location-picker";
import { apiFetch } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

export type UserRow = Omit<EditableUser, "locations"> & {
  status: "ACTIVE" | "INACTIVE";
  lastLoginAt: Date | null;
  locations: { access: "FULL" | "VIEW_ONLY"; location: { id: string; code: string } }[];
};

const ROLE_LABEL = { ADMIN: "Administrator", SUPERVISOR: "Supervisor", FIELD: "Field staff" } as const;

type Pending =
  | { kind: "edit"; user: UserRow }
  | { kind: "status"; user: UserRow }
  | { kind: "reset"; user: UserRow }
  | { kind: "link"; user: UserRow; url: string; expiresAt: string }
  | null;

export function UsersList({ users, locations, meId }: { users: UserRow[]; locations: LocationOption[]; meId: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      cell: (u) => (
        <span>
          <span className="block font-medium">{u.name}</span>
          <span className="block text-sm font-normal [overflow-wrap:anywhere] text-muted-foreground">{u.email}</span>
        </span>
      ),
    },
    { key: "role", header: "Role", cell: (u) => ROLE_LABEL[u.role] },
    { key: "status", header: "Status", cell: (u) => <StatusChip kind="user" status={u.status} /> },
    {
      key: "locations",
      header: "Locations",
      cell: (u) => (u.role === "ADMIN" ? "All" : u.locations.map((l) => l.location.code).join(", ") || "None"),
    },
    { key: "login", header: "Last sign-in", className: "min-w-36", cell: (u) => formatDateTime(u.lastLoginAt) },
  ];

  const deactivating = pending?.kind === "status" && pending.user.status === "ACTIVE";

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, their role, and where they work."
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus aria-hidden /> Add user
          </Button>
        }
      />
      <DataList
        label="Users"
        rows={users}
        columns={columns}
        rowKey={(u) => u.id}
        empty={{ title: "No users yet", icon: Users, description: "Add the first person who needs to sign in." }}
        rowLabel={(u) => u.name}
        actions={(u) => [
          { label: "Edit", icon: Pencil, onSelect: () => setPending({ kind: "edit", user: u }) },
          {
            label: "Reset link",
            icon: KeyRound,
            onSelect: () => setPending({ kind: "reset", user: u }),
            disabled: u.status !== "ACTIVE",
          },
          ...(u.id === meId
            ? []
            : [
                {
                  label: u.status === "ACTIVE" ? "Deactivate" : "Reactivate",
                  icon: u.status === "ACTIVE" ? UserX : UserCheck,
                  onSelect: () => setPending({ kind: "status", user: u }),
                  destructive: u.status === "ACTIVE",
                },
              ]),
        ]}
      />

      <UserForm open={creating} onOpenChange={setCreating} locations={locations} />
      {pending?.kind === "edit" && (
        <UserForm
          key={pending.user.id}
          open
          onOpenChange={(o) => !o && close()}
          user={pending.user}
          locations={locations}
        />
      )}

      <ConfirmSheet
        open={pending?.kind === "status"}
        onOpenChange={(o) => !o && close()}
        title={deactivating ? `Deactivate ${pending?.user.name}?` : `Reactivate ${pending?.user.name}?`}
        description={
          deactivating
            ? "They are signed out on every device right away and can't sign in. Their history stays."
            : "They can sign in again with their existing password."
        }
        changes={
          pending?.kind === "status"
            ? [
                {
                  label: "Status",
                  from: deactivating ? "Active" : "Inactive",
                  to: deactivating ? "Inactive" : "Active",
                },
              ]
            : []
        }
        confirmLabel={deactivating ? "Deactivate user" : "Reactivate user"}
        tone={deactivating ? "destructive" : "default"}
        onConfirm={async () => {
          const u = (pending as { user: UserRow }).user;
          await apiFetch(`/api/v1/users/${u.id}`, {
            method: "PATCH",
            body: { status: deactivating ? "INACTIVE" : "ACTIVE" },
          });
          toast.success(deactivating ? `${u.name} is deactivated.` : `${u.name} can sign in again.`);
          router.refresh();
        }}
      />

      <ConfirmSheet
        open={pending?.kind === "reset"}
        onOpenChange={(o) => !o && close()}
        title={`Create a reset link for ${pending?.user.name}?`}
        description="The link works once and expires in 1 hour. Any earlier link stops working. Setting a new password signs them out everywhere."
        confirmLabel="Create reset link"
        onConfirm={async () => {
          const u = (pending as { user: UserRow }).user;
          const r = await apiFetch<{ url: string; expiresAt: string }>(`/api/v1/users/${u.id}/password-reset`, {
            method: "POST",
          });
          // Open the "show link" step after the confirm sheet closes.
          setTimeout(
            () => setPending({ kind: "link", user: u, url: window.location.origin + r.url, expiresAt: r.expiresAt }),
            0,
          );
        }}
      />

      <ResponsiveDialog
        open={pending?.kind === "link"}
        onOpenChange={(o) => !o && close()}
        title="Reset link ready"
        description={
          pending?.kind === "link"
            ? `Give this link to ${pending.user.name} directly. It expires ${formatDateTime(pending.expiresAt)} and is shown only once.`
            : undefined
        }
        footer={<Button onClick={close}>Done</Button>}
      >
        {pending?.kind === "link" && (
          <div className="flex gap-2">
            <label htmlFor="reset-url" className="sr-only">
              Reset link
            </label>
            <Input id="reset-url" readOnly value={pending.url} onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(pending.url);
                toast.success("Link copied.");
              }}
            >
              <Copy aria-hidden /> Copy
            </Button>
          </div>
        )}
      </ResponsiveDialog>
    </>
  );
}
