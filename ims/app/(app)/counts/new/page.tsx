import { NoAccess } from "@/components/common/no-access";
import { NewCountWizard } from "@/components/counts/new-count-wizard";
import { pageAccess } from "@/lib/auth/page";
import { prisma } from "@/lib/db/prisma";
import { assignableUsers, countablesAt } from "@/lib/counts/service";
import { locationsFor } from "@/lib/inventory/page-data";

export const metadata = { title: "New count" };

export default async function NewCountPage() {
  const { user, allowed } = await pageAccess("counts.create");
  if (!allowed) return <NoAccess what="Counts" />;
  const locs = await locationsFor(user, "counts.create");
  if (!locs.length) return <NoAccess what="Counts" />;
  const ids = locs.map((l) => l.id);
  const [people, countable, categories] = await Promise.all([
    assignableUsers(user, ids),
    countablesAt(user, ids),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <NewCountWizard
      locations={locs.map((l) => ({ ...l, people: people[l.id] ?? [], countable: countable[l.id] ?? [] }))}
      categories={categories}
    />
  );
}
