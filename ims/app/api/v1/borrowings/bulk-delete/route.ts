import { bulkDeleteBorrowings, bulkDeleteRoute } from "@/lib/bulk-delete";

/** Closed tab: cancelled requests are deleted, closed loans hidden (see lib/bulk-delete.ts). */
export const POST = bulkDeleteRoute(bulkDeleteBorrowings);
