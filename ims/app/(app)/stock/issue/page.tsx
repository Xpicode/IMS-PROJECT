import { NoAccess } from "@/components/common/no-access";
import { StockWizard } from "@/components/inventory/stock-wizard";
import { pageAccess } from "@/lib/auth/page";
import { locationsFor, one } from "@/lib/inventory/page-data";
import { prisma } from "@/lib/db/prisma";

export const metadata = { title: "Issue stock" };

export default async function Page({ searchParams }: PageProps<"/stock/issue">) {
  const { user, allowed } = await pageAccess("stock.move");
  if (!allowed) return <NoAccess what="Stock movements" />;
  const itemId = one((await searchParams).item);
  const item =
    itemId && /^[0-9a-f-]{36}$/i.test(itemId)
      ? await prisma.item.findFirst({
          where: { id: itemId, isActive: true, trackingType: "STOCK" },
          select: { id: true, sku: true, name: true, trackingType: true, unit: { select: { code: true } } },
        })
      : null;
  return (
    <StockWizard
      mode="issue"
      locations={await locationsFor(user, "stock.move")}
      initialItem={
        item
          ? { id: item.id, sku: item.sku, name: item.name, trackingType: item.trackingType, unitCode: item.unit.code }
          : undefined
      }
    />
  );
}
