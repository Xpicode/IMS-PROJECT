import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { pageAccess, ROLE_LABEL } from "@/lib/auth/page";
import { prisma } from "@/lib/db/prisma";
import { signOutAction } from "../actions";

export const metadata = { title: "Me" };

export default async function MePage() {
  const { user } = await pageAccess();
  const locations =
    user.role === "ADMIN"
      ? []
      : await prisma.location.findMany({
          where: { id: { in: user.locations.map((l) => l.id) } },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
        });
  const access = new Map(user.locations.map((l) => [l.id, l.access]));

  return (
    <>
      <PageHeader title="Me" />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border bg-card p-4 md:p-6" aria-labelledby="profile">
          <h2 id="profile" className="mb-3 text-lg font-semibold">
            Profile
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all">{user.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{ROLE_LABEL[user.role]}</dd>
          </dl>
        </section>
        <section className="rounded-xl border bg-card p-4 md:p-6" aria-labelledby="my-locations">
          <h2 id="my-locations" className="mb-3 text-lg font-semibold">
            My locations
          </h2>
          {user.role === "ADMIN" ? (
            <p>All locations (administrator).</p>
          ) : locations.length === 0 ? (
            <p className="text-muted-foreground">No locations assigned. Ask an administrator to add you to one.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {locations.map((l) => (
                <li key={l.id}>
                  <span className="font-medium">{l.code}</span> · {l.name}
                  {access.get(l.id) === "VIEW_ONLY" && <span className="text-muted-foreground"> (view only)</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl border bg-card p-4 md:col-span-2 md:p-6" aria-labelledby="device">
          <h2 id="device" className="mb-1 text-lg font-semibold">
            This device
          </h2>
          <p className="text-muted-foreground">
            Offline storage, install help, and storage checks arrive with the field app (build phase 3). Nothing is
            stored on this device yet.
          </p>
        </section>
      </div>
      <form action={signOutAction} className="mt-6">
        <Button type="submit" variant="outline" className="w-full sm:w-auto">
          <LogOut aria-hidden /> Sign out
        </Button>
      </form>
    </>
  );
}
