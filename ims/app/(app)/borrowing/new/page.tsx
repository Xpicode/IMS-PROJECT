import { NoAccess } from "@/components/common/no-access";
import { BorrowWizard, type BorrowInitial } from "@/components/borrowing/borrow-wizard";
import { pageAccess } from "@/lib/auth/page";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/permissions";
import { locationsFor, one } from "@/lib/inventory/page-data";

export const metadata = { title: "Borrow items" };
const UUID = /^[0-9a-f-]{36}$/i;
const item = { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } } as const;
const picked = (i: { id: string; sku: string; name: string; unit: { code: string } }) => ({
  id: i.id,
  sku: i.sku,
  name: i.name,
  unitCode: i.unit.code,
});

export default async function NewBorrowingPage({ searchParams }: PageProps<"/borrowing/new">) {
  const { user, allowed } = await pageAccess("custody.confirm");
  if (!allowed) return <NoAccess what="Borrowing" />;
  const sp = await searchParams;
  const locations = await locationsFor(user, "custody.confirm");
  const initial: BorrowInitial = {};

  // Release a request prepared in the field: its items and quantities.
  const draftId = one(sp.draft);
  if (draftId && UUID.test(draftId)) {
    const d = await prisma.borrowing.findUnique({
      where: { id: draftId },
      include: { lines: { include: { item }, orderBy: { item: { name: "asc" } } } },
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
        lines: d.lines.map((l) => ({ item: picked(l.item), quantity: l.quantity })),
      });
    }
  }
  // "Borrow" from an item page: start with that item.
  const itemId = one(sp.item);
  if (!initial.draftId && itemId && UUID.test(itemId)) {
    const i = await prisma.item.findUnique({ where: { id: itemId, isActive: true }, ...item });
    if (i) initial.lines = [{ item: picked(i), quantity: 1 }];
  }
  return <BorrowWizard locations={locations} initial={initial} />;
}
