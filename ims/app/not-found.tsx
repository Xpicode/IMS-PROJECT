import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center p-4">
      <EmptyState
        className="w-full"
        icon={SearchX}
        title="Page not found"
        description="This page doesn't exist, or you don't have access to it."
        action={
          <Button asChild>
            <Link href="/">Go to home</Link>
          </Button>
        }
      />
    </main>
  );
}
