import { bulkDeleteUsers, bulkDeleteRoute } from "@/lib/bulk-delete";

/** Select and delete: never-used rows are deleted, used ones hidden (see lib/bulk-delete.ts). */
export const POST = bulkDeleteRoute(bulkDeleteUsers);
