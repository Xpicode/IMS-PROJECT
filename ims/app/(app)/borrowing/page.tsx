import { ArrowLeftRight } from "lucide-react";
import { ComingSoon } from "@/components/common/coming-soon";
import { NoAccess } from "@/components/common/no-access";
import { pageAccess } from "@/lib/auth/page";

export const metadata = { title: "Borrowing" };

export default async function Page() {
  const { allowed } = await pageAccess("custody.confirm");
  if (!allowed) return <NoAccess what="Borrowing" />;
  return (
    <ComingSoon title="Borrowing" icon={ArrowLeftRight} what="Loans, releases, returns, and handovers." phase={5} />
  );
}
