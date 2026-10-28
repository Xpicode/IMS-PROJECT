import { ScanLine } from "lucide-react";
import { ComingSoon } from "@/components/common/coming-soon";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Scan" };

export default async function Page() {
  await pageAccess();
  return (
    <ComingSoon
      title="Scan"
      icon={ScanLine}
      what="Scan a QR code or barcode with the camera, or type a code."
      phase={3}
    />
  );
}
