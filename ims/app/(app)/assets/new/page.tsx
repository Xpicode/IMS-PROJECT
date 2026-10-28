import Link from "next/link";
import { NoAccess } from "@/components/common/no-access";
import { PageHeader } from "@/components/common/page-header";
import { AddAssetsForm } from "@/components/assets/add-assets-form";
import { pageAccess } from "@/lib/auth/page";
import { locationsFor, one } from "@/lib/inventory/page-data";
import { prisma } from "@/lib/db/prisma";

export const metadata = { title: "Add assets" };

export default async function Page({ searchParams }: PageProps<"/assets/new">) {
  const { user, allowed } = await pageAccess("masterData.manage");
  if (!allowed) return <NoAccess what="Adding assets" />;
  const itemId = one((await searchParams).item);
  const item =
    itemId && /^[0-9a-f-]{36}$/i.test(itemId)
      ? await prisma.item.findFirst({
          where: { id: itemId, isActive: true, trackingType: "ASSET" },
          select: { id: true, sku: true, name: true, unit: { select: { code: true } } },
        })
      : null;
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link href="/assets" className="text-muted-foreground underline-offset-4 hover:underline">
          Assets
        </Link>{" "}
        / Add
      </nav>
      <PageHeader
        title="Add assets"
        description="Create several identical assets at once. Each gets its own tag and history."
      />
      <AddAssetsForm
        locations={await locationsFor(user, "masterData.manage")}
        initialItem={
          item
            ? { id: item.id, sku: item.sku, name: item.name, unitCode: item.unit.code, trackingType: "ASSET" }
            : undefined
        }
      />
    </>
  );
}
