import { ClipboardCheck } from "lucide-react";
import { ComingSoon } from "@/components/common/coming-soon";
import { NoAccess } from "@/components/common/no-access";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Counts" };

export default async function Page() {
  const { allowed } = await pageAccess("counts.create");
  if (!allowed) return <NoAccess what="Counts" />;
  return (
    <ComingSoon
      title="Counts"
      icon={ClipboardCheck}
      what="Count sessions, progress, and reconciliation review."
      phase={4}
    />
  );
}
