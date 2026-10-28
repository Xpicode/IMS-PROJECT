import { Boxes } from "lucide-react";
import { ComingSoon } from "@/components/common/coming-soon";
import { NoAccess } from "@/components/common/no-access";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Stock" };

export default async function Page() {
  const { allowed } = await pageAccess("records.view");
  if (!allowed) return <NoAccess what="Stock" />;
  return <ComingSoon title="Stock" icon={Boxes} what="Items, balances per location, receiving, issuing, and transfers." phase={2} />;
}
