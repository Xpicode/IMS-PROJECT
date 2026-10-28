import { NoAccess } from "@/components/common/no-access";
import { PageHeader } from "@/components/common/page-header";
import { CatalogManager } from "@/components/inventory/catalog-manager";
import { pageAccess } from "@/lib/auth/page";
import { listCatalog } from "@/lib/inventory/items";

export const metadata = { title: "Units & categories" };

export default async function Page() {
  const { user, allowed } = await pageAccess("masterData.manage");
  if (!allowed) return <NoAccess what="Units & categories" />;
  const { units, categories } = await listCatalog(user);
  return (
    <>
      <PageHeader
        title="Units & categories"
        description="Shared by all locations. Add them before importing items that use them."
      />
      <CatalogManager
        units={units.map((u) => ({ id: u.id, code: u.code, name: u.name, count: u._count.items }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, count: c._count.items }))}
      />
    </>
  );
}
