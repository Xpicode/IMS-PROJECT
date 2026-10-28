import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

export function NoAccess({ what = "this page" }: { what?: string }) {
  return (
    <EmptyState
      icon={ShieldX}
      title="You don't have access"
      description={`Your role can't open ${what}. If you need it, ask a supervisor or administrator.`}
      action={
        <Button asChild variant="outline">
          <Link href="/">Go to home</Link>
        </Button>
      }
    />
  );
}
