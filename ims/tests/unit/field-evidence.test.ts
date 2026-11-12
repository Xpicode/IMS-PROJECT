import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FieldDB } from "@/lib/field/db";
import { saveCountDraft } from "@/lib/field/store";
import { submitDrafts, syncNow, type SyncDeps } from "@/lib/field/outbox";

let db: FieldDB;
beforeEach(async () => {
  db = new FieldDB("evidence-test");
  await db.open();
  await db.targets.put({
    id: "target",
    sessionId: "session",
    kind: "STOCK",
    version: 1,
    itemId: "item",
    sku: "SKU",
    name: "Item",
    unit: "pcs",
    assetId: null,
    tag: null,
    serialNumber: null,
    lastStatus: null,
    lastCondition: null,
  });
});
afterEach(async () => {
  db.close();
  await db.delete();
});
const photo = { id: "photo", blob: new Blob(["image"], { type: "image/jpeg" }) };
const input = { sessionId: "session", targetId: "target", kind: "STOCK" as const, quantity: 2, notes: "" };
const deps = (fetcher: typeof fetch): SyncDeps => ({
  userId: "me",
  fetch: fetcher,
  whoAmI: async () => ({ state: "online", user: { id: "me", name: "Counter", role: "FIELD" } }),
});

it("stores photos and draft atomically, freezes IDs, and retains old Blobs after editing", async () => {
  const d = await saveCountDraft(db, { ...input, photos: [photo] });
  expect(d.evidenceIds).toEqual([photo.id]);
  expect((await db.photos.get(photo.id))?.blob.size).toBe(photo.blob.size);
  await submitDrafts(db, "me");
  const frozen = (await db.outbox.toArray())[0];
  await saveCountDraft(db, { ...input, photos: [] });
  expect((await db.countDrafts.get(d.id))?.evidenceIds).toEqual([]);
  expect((await db.outbox.get(frozen.operationId))?.payload).toMatchObject({ payload: { evidenceIds: [photo.id] } });
  expect(await db.photos.get(photo.id)).toBeDefined();
  await expect(saveCountDraft(db, { ...input, quantity: 5, photos: [photo, photo] })).rejects.toThrow();
  expect((await db.countDrafts.get(d.id))?.quantity).toBe(2);
});

it("upload failure never pushes or acknowledges a count; retry uploads before push with stable IDs", async () => {
  await saveCountDraft(db, { ...input, photos: [photo] });
  await submitDrafts(db, "me");
  const op = (await db.outbox.toArray())[0];
  const calls: string[] = [];
  let fail = true;
  const fetcher = (async (url: string | URL | Request) => {
    calls.push(String(url));
    if (String(url).includes("/evidence/")) return new Response(null, { status: fail ? 503 : 201 });
    return Response.json({ results: [{ operationId: op.operationId, status: "ACKED" }] });
  }) as typeof fetch;
  expect(await syncNow(db, deps(fetcher))).toMatchObject({ failed: 1, acked: 0 });
  expect(calls).toHaveLength(1);
  expect((await db.outbox.get(op.operationId))?.status).toBe("FAILED");
  fail = false;
  expect(await syncNow(db, deps(fetcher))).toMatchObject({ acked: 1 });
  expect(calls[0]).toBe(calls[1]);
  expect(calls[2]).toBe("/api/v1/sync/push");
});

it("missing local Blob never sends the count", async () => {
  await saveCountDraft(db, { ...input, photos: [photo] });
  await submitDrafts(db, "me");
  await db.photos.clear();
  let called = false;
  const fetcher = (async () => {
    called = true;
    return new Response();
  }) as typeof fetch;
  expect(await syncNow(db, deps(fetcher))).toMatchObject({ failed: 1, acked: 0 });
  expect(called).toBe(false);
});

it("a response for a different operation cannot acknowledge this count", async () => {
  await saveCountDraft(db, input);
  await submitDrafts(db, "me");
  const fetcher = (async () =>
    Response.json({ results: [{ operationId: "unrelated", status: "ACKED" }] })) as typeof fetch;
  expect(await syncNow(db, deps(fetcher))).toMatchObject({ acked: 0, failed: 1 });
  expect((await db.outbox.toArray())[0].status).toBe("FAILED");
});

it("a photo store failure rolls back both the count and other photo writes", async () => {
  await db.photos.add({ ...photo, sessionId: "another-session", targetId: "another-target" });
  await expect(
    saveCountDraft(db, { ...input, photos: [{ id: "first-new", blob: photo.blob }, photo] }),
  ).rejects.toThrow();
  expect(await db.countDrafts.count()).toBe(0);
  expect(await db.photos.get("first-new")).toBeUndefined();
});

it("upgrades v3 without deleting drafts or frozen operations", async () => {
  db.close();
  await db.delete();
  const old = new Dexie("evidence-test");
  old.version(3).stores({
    assignments: "id, downloadedAt",
    targets: "id, sessionId, [sessionId+kind]",
    identifiers: "[sessionId+code], code, targetId",
    countDrafts: "id, sessionId, targetId, updatedAt",
    outbox: "operationId, userId, sessionId, status, createdAt, draftId, seq",
    syncMeta: "id",
    inboxConflicts: "operationId, sessionId",
    borrowDrafts: "id, status, updatedAt",
  });
  await old.open();
  await old.table("countDrafts").put({ id: "old", quantity: 7 });
  await old.table("outbox").put({ operationId: "old-op", payload: { quantity: 7 } });
  old.close();
  db = new FieldDB("evidence-test");
  await db.open();
  expect(await db.countDrafts.get("old")).toEqual({ id: "old", quantity: 7 });
  expect((await db.outbox.get("old-op"))?.payload).toEqual({ quantity: 7 });
  expect(await db.photos.count()).toBe(0);
});
