import { idempotencyKey, json, pageParam, readJson, route } from "@/lib/api/route";
import { createBorrowDraft, listBorrowings, type LoanTab } from "@/lib/borrowing/service";
import type { BorrowDraftInput } from "@/lib/validation";

const TABS: LoanTab[] = ["requests", "active", "overdue", "closed"];

/** GET ?tab=requests|active|overdue|closed&q=&page= → loans. */
export const GET = route({ auth: true }, async ({ req, user }) => {
  const url = new URL(req.url);
  const t = url.searchParams.get("tab") as LoanTab;
  return json(
    await listBorrowings(user, {
      tab: TABS.includes(t) ? t : "active",
      q: url.searchParams.get("q") ?? undefined,
      page: pageParam(url),
    }),
  );
});

/**
 * POST (Idempotency-Key required: the phone's draft id) → a borrowing request:
 * no number, nothing changes until a supervisor releases it.
 */
export const POST = route({ auth: true }, async ({ req, user, ctx }) => {
  const key = idempotencyKey(req);
  return json(await createBorrowDraft(user, (await readJson(req)) as BorrowDraftInput, ctx, key), 201);
});
