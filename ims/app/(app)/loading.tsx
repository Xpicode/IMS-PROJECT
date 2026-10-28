import { DataListSkeleton } from "@/components/common/data-list";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-muted" />
      <DataListSkeleton />
    </div>
  );
}
