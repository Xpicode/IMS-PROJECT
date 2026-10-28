import type { FieldDB } from "./db";
import { saveBootstrap, type BootstrapPayload } from "./store";

/**
 * Simple pull after a send (spec §11.3 "re-fetch active assignments"):
 * open assignments are downloaded again (new line versions show recount
 * requests); ones the server no longer lists are marked CLOSED here. Counts on
 * the phone are never touched. Returns null if the server couldn't be reached.
 */
export async function refreshAssignments(db: FieldDB, fetchFn: typeof fetch) {
  const get = async <T>(url: string): Promise<T | null> => {
    try {
      const r = await fetchFn(url, {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const mine = await get<{ data: { id: string; version: number }[] }>("/api/v1/counts/mine");
  if (!mine) return null;
  const open = new Set(mine.data.map((m) => m.id));
  let updated = 0;
  let closed = 0;
  for (const a of await db.assignments.toArray()) {
    if (open.has(a.id)) {
      const b = await get<BootstrapPayload>(`/api/v1/sync/bootstrap?sessionId=${a.id}`);
      if (b) {
        await saveBootstrap(db, b);
        updated++;
      }
    } else if (a.status !== "CLOSED") {
      await db.assignments.update(a.id, { status: "CLOSED" });
      closed++;
    }
  }
  return { updated, closed };
}
