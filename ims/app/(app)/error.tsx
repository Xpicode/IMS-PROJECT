"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="This page didn't load"
      description="Something went wrong on our side. Your saved work is not affected. Try again, and if it keeps happening tell your administrator."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
