import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/common/coming-soon";
import { NoAccess } from "@/components/common/no-access";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Reports" };

export default async function Page() {
  const { allowed } = await pageAccess("reports.view");
  if (!allowed) return <NoAccess what="Reports" />;
  return (
    <ComingSoon
      title="Reports"
      icon={BarChart3}
      what="Stock balances, movement ledger, asset custody, overdue loans, count discrepancies."
      phase={6}
    />
  );
}
