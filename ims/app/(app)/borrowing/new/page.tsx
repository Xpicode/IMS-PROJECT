import { NoAccess } from "@/components/common/no-access";
import { BorrowWizard, type BorrowInitial, type PickAsset } from "@/components/borrowing/borrow-wizard";
import { pageAccess } from "@/lib/auth/page";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/permissions";
import { locationsFor, one } from "@/lib/inventory/page-data";

export const metadata = { title: "Borrow equipment" };
const UUID = /^[0-9a-f-]{36}$/i;
const select = {
  id: true,
  tag: true,
  serialNumber: true,
  status: true,
  condition: true,
  locationId: true,
  item: { select: { sku: true, name: true } },
  location: { select: { code: true } },
} as const;

export default async function NewBorrowingPage({ searchParams }: PageProps<"/borrowing/new">) {
  const { user, allowed } = await pageAccess("custody.confirm");
  if (!allowed) return <NoAccess what="Borrowing" />;
  const sp = await searchParams;
  const locations = await locationsFor(user, "custody.confirm");
  const initial: BorrowInitial = {};

  const draftId = one(sp.draft);
  if (draftId && UUID.test(draftId)) {
    const d = await prisma.borrowing.findUnique({
      where: { id: draftId },
      include: { lines: { include: { asset: { select } }, orderBy: { asset: { tag: "asc" } } } },
    });
    if (d && d.status === "DRAFT" && can(user, "custody.confirm", d.locationId)) {
      Object.assign(initial, {
        draftId: d.id,
        locationId: d.locationId,
        borrowerName: d.borrowerName,
        borrowerDept: d.borrowerDept ?? "",
        purpose: d.purpose,
        dueDate: d.dueAt ? d.dueAt.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) : "",
        notes: d.notes ?? "",
        assets: d.lines.map((l) => l.asset as PickAsset),
      });
    }
  }
  const assetId = one(sp.asset);
  if (!initial.draftId && assetId && UUID.test(assetId)) {
    const a = await prisma.asset.findUnique({ where: { id: assetId }, select });
    if (a && locations.some((l) => l.id === a.locationId))
      Object.assign(initial, { locationId: a.locationId, assets: [a as PickAsset] });
  }
  return <BorrowWizard locations={locations} initial={initial} />;
}
