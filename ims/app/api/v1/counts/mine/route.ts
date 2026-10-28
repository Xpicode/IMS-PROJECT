import { json, route } from "@/lib/api/route";
import { listMyAssignments } from "@/lib/counts/service";

/** The field app's assignment list (online). Offline, the app reads what it downloaded. */
export const GET = route({ auth: true }, async ({ user }) => json({ data: await listMyAssignments(user) }));
