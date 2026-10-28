import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/common/coming-soon";
import { NoAccess } from "@/components/common/no-access";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Documents" };

export default async function Page() {
  const { allowed } = await pageAccess("documents.download");
  if (!allowed) return <NoAccess what="Documents" />;
  return (
    <ComingSoon
      title="Documents"
      icon={FileText}
      what="Official PDFs: search by number, preview, download, reprint."
      phase={5}
    />
  );
}
