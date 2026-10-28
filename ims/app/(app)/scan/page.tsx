import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { ScanLookup } from "@/components/scan/scan-lookup";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Scan" };

export default async function Page() {
  const { user } = await pageAccess();
  if (user.role === "FIELD") redirect("/field?v=scan");
  return (
    <>
      <PageHeader
        title="Scan"
        description="Scan a label or barcode with the camera, or type the code, to open the item, asset, or location."
      />
      <ScanLookup />
    </>
  );
}
