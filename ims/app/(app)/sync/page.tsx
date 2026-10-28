import { RefreshCw } from "lucide-react";
import { ComingSoon } from "@/components/common/coming-soon";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Sync" };

export default async function Page() {
  await pageAccess();
  return (
    <ComingSoon
      title="Sync"
      icon={RefreshCw}
      what="Work saved on this device and what the server has received. Nothing is stored on this device yet."
      phase={4}
    />
  );
}
