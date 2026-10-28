import { Wrench } from "lucide-react";
import { ComingSoon } from "@/components/common/coming-soon";
import { NoAccess } from "@/components/common/no-access";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Assets" };

export default async function Page() {
  const { allowed } = await pageAccess("records.view");
  if (!allowed) return <NoAccess what="Assets" />;
  return (
    <ComingSoon title="Assets" icon={Wrench} what="The asset registry with tags, custodians, and history." phase={2} />
  );
}
