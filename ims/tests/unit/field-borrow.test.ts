import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFieldDB, type FieldDB } from "@/lib/field/db";
import { listBorrowDrafts, saveBorrowDraft, sendBorrowDraft, removeBorrowDraft } from "@/lib/field/borrow";

let db: FieldDB;
beforeEach(async () => {
  db = makeFieldDB(`u-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const LOC = { id: "11111111-1111-4111-8111-111111111111", code: "SITE-B", name: "Site B" };
const input = {
  location: LOC,
  borrowerName: " Ana Cruz ",
  borrowerDept: "",
  purpose: "Survey",
  tags: ["tool-0001", "TOOL-0001", " tool-0002 "],
  notes: "",
};

type Call = { url: string; init: RequestInit };
const fetcher = (responses: (Response | Error)[]) => {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    if (r instanceof Error) throw r;
    return r;
  };
  return { fn, calls };
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

it("saves a request on the phone only: cleaned up, tags unique and upper-case, not official", async () => {
  const d = await saveBorrowDraft(db, input);
  expect(d).toMatchObject({ status: "DRAFT", borrowerName: "Ana Cruz", tags: ["TOOL-0001", "TOOL-0002"] });
  expect(await listBorrowDrafts(db)).toHaveLength(1);
  await expect(saveBorrowDraft(db, { ...input, tags: [] })).rejects.toThrow(/at least one asset/i);
  await expect(saveBorrowDraft(db, { ...input, borrowerName: " " })).rejects.toThrow(/who is borrowing/i);
});

it("sends with the draft id as Idempotency-Key, and a resend after a lost reply reuses it", async () => {
  const d = await saveBorrowDraft(db, input);
  const f = fetcher([new TypeError("Failed to fetch"), json(201, { id: "server-1" })]);
  const first = await sendBorrowDraft(db, d.id, f.fn);
  expect(first.status).toBe("FAILED");
  expect((await listBorrowDrafts(db))[0]).toMatchObject({ status: "FAILED", attempts: 1 });
  const second = await sendBorrowDraft(db, d.id, f.fn);
  expect(second).toMatchObject({ status: "SENT", serverId: "server-1" });
  const keys = f.calls.map((c) => (c.init.headers as Record<string, string>)["idempotency-key"]);
  expect(keys).toEqual([d.id, d.id]);
  expect(JSON.parse(String(f.calls[1].init.body))).toEqual({
    locationId: LOC.id,
    borrowerName: "Ana Cruz",
    purpose: "Survey",
    assetTags: ["TOOL-0001", "TOOL-0002"],
  });
  expect(f.calls[0].init.method).toBe("POST");
});

it("keeps a refused request on the phone with the server's reason, and never resends it by itself", async () => {
  const d = await saveBorrowDraft(db, input);
  const f = fetcher([
    json(422, { code: "VALIDATION_FAILED", message: "No asset has the tag TOOL-0002. Check the label." }),
  ]);
  const r = await sendBorrowDraft(db, d.id, f.fn);
  expect(r).toMatchObject({ status: "REJECTED", error: "No asset has the tag TOOL-0002. Check the label." });
  // Editing it makes it a draft again; deleting only works for unsent ones.
  const again = await saveBorrowDraft(db, { ...input, id: d.id, tags: ["TOOL-0001"] });
  expect(again.status).toBe("DRAFT");
  expect(again.id).not.toBe(d.id); // a changed request is a new request (new key)
  expect(await listBorrowDrafts(db)).toHaveLength(1);
});

it("a sent request can't be sent twice or edited", async () => {
  const d = await saveBorrowDraft(db, input);
  const f = fetcher([json(201, { id: "server-1" })]);
  await sendBorrowDraft(db, d.id, f.fn);
  const r = await sendBorrowDraft(db, d.id, f.fn);
  expect(r.status).toBe("SENT");
  expect(f.calls).toHaveLength(1);
  await expect(saveBorrowDraft(db, { ...input, id: d.id })).rejects.toThrow(/already sent/i);
  await removeBorrowDraft(db, d.id);
  expect(await listBorrowDrafts(db)).toHaveLength(0);
});

it("sends assets scanned by QR as ids (the label holds no tag)", async () => {
  const id = "33333333-3333-4333-8333-333333333333";
  const d = await saveBorrowDraft(db, {
    ...input,
    tags: [],
    assetIds: [
      { id, label: "TOOL-0009" },
      { id, label: "TOOL-0009" },
    ],
  });
  const f = fetcher([json(201, { id: "s" })]);
  await sendBorrowDraft(db, d.id, f.fn);
  expect(JSON.parse(String(f.calls[0].init.body))).toMatchObject({ assetTags: [], assetIds: [id] });
});

it("a sign-in problem is not a refusal: it stays ready to send", async () => {
  const d = await saveBorrowDraft(db, input);
  const f = fetcher([json(401, { code: "UNAUTHENTICATED", message: "Sign in again." })]);
  const r = await sendBorrowDraft(db, d.id, f.fn);
  expect(r.status).toBe("FAILED");
  expect(r.error).toMatch(/sign in/i);
});
