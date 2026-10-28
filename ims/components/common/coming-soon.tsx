import type { LucideIcon } from "lucide-react";
import { PageHeader } from "./page-header";
import { EmptyState } from "./empty-state";

/** Placeholder for menu sections built in a later phase. Honest about what's missing. */
export function ComingSoon({
  title,
  icon,
  what,
  phase,
}: {
  title: string;
  icon?: LucideIcon;
  what: string;
  phase: number;
}) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        icon={icon}
        title="Not set up yet"
        description={
          <>
            {what} <span className="block pt-1 text-sm">Planned for build phase {phase}.</span>
          </>
        }
      />
    </>
  );
}
