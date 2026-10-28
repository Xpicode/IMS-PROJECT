import Link from "next/link";
import { ClipboardList, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { pageAccess } from "@/lib/auth/page";
import { can } from "@/lib/permissions";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const { user } = await pageAccess();
  const first = user.name.split(" ")[0];

  if (user.role === "FIELD") {
    return (
      <>
        <PageHeader title="My assignments" description={`Hello, ${first}.`} />
        <EmptyState
          icon={ClipboardList}
          title="No assignments yet"
          description="When a supervisor assigns you a count, it appears here. Download it while you have internet so you can count offline."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Dashboard" description={`Hello, ${first}.`} />
      <section aria-labelledby="needs-action" className="flex flex-col gap-3">
        <h2 id="needs-action" className="text-xl font-semibold">
          Needs your action
        </h2>
        <EmptyState
          icon={ListChecks}
          title="Nothing needs you right now"
          description="Count reviews, drafts to release, and failed PDFs will be listed here once those features are built."
          action={
            can(user, "locations.manage") ? (
              <Button asChild variant="outline">
                <Link href="/locations">Set up locations</Link>
              </Button>
            ) : undefined
          }
        />
      </section>
    </>
  );
}
