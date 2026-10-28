import Link from "next/link";
import { NoAccess } from "@/components/common/no-access";
import { PageHeader } from "@/components/common/page-header";
import { ImportScreen } from "@/components/inventory/import-screen";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Import items" };

export default async function Page() {
  const { allowed } = await pageAccess("masterData.manage");
  if (!allowed) return <NoAccess what="Importing items" />;
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link href="/stock" className="text-muted-foreground underline-offset-4 hover:underline">
          Stock
        </Link>{" "}
        / Import
      </nav>
      <PageHeader
        title="Import items from CSV"
        description="Check every row before anything is saved. Only valid rows are imported."
      />
      <ImportScreen />
    </>
  );
}
