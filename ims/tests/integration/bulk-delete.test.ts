import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { receiveStock } from "@/lib/inventory/stock";
import { createAssets } from "@/lib/assets/service";
import { closeCountSession, createCountSession, listCountSessions } from "@/lib/counts/service";
import { keepExpected } from "@/lib/counts/review";
import {
  bulkDeleteAssets,
  bulkDeleteCounts,
  bulkDeleteItems,
  bulkDeleteLocations,
  bulkDeleteUsers,
} from "@/lib/bulk-delete";
import { createSession } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import * as itemsBulk from "@/app/api/v1/items/bulk-delete/route";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function world() {
  const wh = await makeLocation("WH-A");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const field = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id))!;
  const item = (sku: string, trackingType: "STOCK" | "ASSET" = "STOCK", barcode?: string) =>
    createItem(admin, { sku, name: sku, unitId: pcs.id, trackingType, barcode }, ctx());
  return { wh, admin, field, item };
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e as ApiError).code,
  );

describe("select and delete", () => {
  it("items: never used are deleted (with their barcode); used ones are hidden; field staff can't", async () => {
    const w = await world();
    const fresh = await w.item("NEW-1", "STOCK", "4800000000017");
    const used = await w.item("USED-1");
    await receiveStock(
      w.admin,
      { locationId: w.wh.id, lines: [{ itemId: used.id, quantity: 5 }] },
      ctx(),
      randomUUID(),
    );

    expect(await code(bulkDeleteItems(w.field, [fresh.id], ctx()))).toBe("FORBIDDEN");
    const r = await bulkDeleteItems(w.admin, [fresh.id, used.id], ctx());
    expect(r).toEqual({ deleted: ["NEW-1"], hidden: ["USED-1"], skipped: [] });
    expect(await prisma.item.findUnique({ where: { id: fresh.id } })).toBeNull();
    expect(await prisma.itemIdentifier.count()).toBe(0);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: used.id } })).isActive).toBe(false);
    expect(await prisma.stockMovement.count()).toBe(1); // history untouched
    expect(await prisma.auditEvent.count({ where: { eventType: "item.deleted" } })).toBe(1);
  });

  it("assets: retired, never deleted (asset history is append-only); one out on loan is skipped", async () => {
    const w = await world();
    const drill = await w.item("DRILL", "ASSET");
    const { assets } = await createAssets(
      w.admin,
      { itemId: drill.id, locationId: w.wh.id, quantity: 2, tagPrefix: "TOOL" },
      ctx(),
    );
    const [a, b] = await prisma.asset.findMany({
      where: { id: { in: assets.map((x) => x.id) } },
      orderBy: { tag: "asc" },
    });
    await prisma.$executeRaw`UPDATE assets SET status = 'BORROWED' WHERE id = ${b.id}::uuid`; // as if released on a loan

    const r = await bulkDeleteAssets(w.admin, [a.id, b.id], ctx());
    expect(r.deleted).toEqual([]);
    expect(r.hidden).toEqual(["TOOL-0001"]);
    expect(r.skipped).toEqual([{ label: "TOOL-0002", reason: expect.stringMatching(/borrowed/i) }]);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("RETIRED");
    expect(await prisma.assetEvent.count({ where: { assetId: a.id } })).toBe(2); // Added + Status changed: kept
  });

  it("locations: an empty one is deleted; one with stock or people assigned is deactivated", async () => {
    const w = await world();
    const empty = await makeLocation("EMPTY");
    const r = await bulkDeleteLocations(w.admin, [empty.id, w.wh.id], ctx()); // WH-A has a field user assigned
    expect(r).toEqual({ deleted: ["EMPTY"], hidden: ["WH-A"], skipped: [] });
    expect((await prisma.location.findUniqueOrThrow({ where: { id: w.wh.id } })).isActive).toBe(false);
  });

  it("users: someone who never did anything is deleted; someone with activity is deactivated; never yourself", async () => {
    const w = await world();
    const idle = await makeUser("FIELD", [{ id: w.wh.id }]);
    const active = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    await createItem(
      active,
      { sku: "BY-ACTIVE", name: "x", unitId: (await prisma.unit.findFirstOrThrow()).id, trackingType: "STOCK" },
      ctx(),
    );

    const r = await bulkDeleteUsers(w.admin, [idle.id, active.id, w.admin.id], ctx());
    expect(r.deleted).toEqual([idle.email]);
    expect(r.hidden).toHaveLength(1);
    expect(r.skipped).toEqual([{ label: expect.any(String), reason: expect.stringMatching(/own account/) }]);
    expect(await prisma.user.findUnique({ where: { id: idle.id } })).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("INACTIVE");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.admin.id } })).status).toBe("ACTIVE");
  });

  it("counts: an empty one is deleted; an open one with decisions is cancelled; a closed one is kept", async () => {
    const w = await world();
    const paper = await w.item("PAPER");
    await receiveStock(
      w.admin,
      { locationId: w.wh.id, lines: [{ itemId: paper.id, quantity: 10 }] },
      ctx(),
      randomUUID(),
    );
    const make = (name: string) =>
      createCountSession(w.admin, { name, locationId: w.wh.id, includeStock: true, includeAssets: false }, ctx());
    const decide = async (id: string) => {
      const t = await prisma.countSessionItem.findFirstOrThrow({ where: { sessionId: id } });
      await keepExpected(w.admin, id, t.id, {}, ctx());
    };
    const empty = await make("Empty");
    const open = await make("Started");
    await decide(open.id);
    const closed = await make("Done");
    await decide(closed.id);
    await closeCountSession(w.admin, closed.id, ctx());

    expect(await code(bulkDeleteCounts(w.field, [empty.id], ctx()))).toBe("FORBIDDEN");
    const r = await bulkDeleteCounts(w.admin, [empty.id, open.id, closed.id], ctx());
    expect(r.deleted).toEqual([empty.reference]);
    expect(r.hidden).toEqual([open.reference]);
    expect(r.skipped).toEqual([{ label: closed.reference, reason: expect.stringMatching(/kept/) }]);
    expect(await prisma.countSession.findUnique({ where: { id: empty.id } })).toBeNull();
    expect((await prisma.countSession.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("CANCELLED");
    expect(await prisma.countReview.count()).toBe(2); // decisions untouched
    // The list leaves cancelled counts out.
    expect((await listCountSessions(w.admin, {})).rows.map((c) => c.reference)).toEqual([closed.reference]);
  });

  it("API: POST /items/bulk-delete returns what was deleted; bad input is refused", async () => {
    const w = await world();
    const a = await w.item("API-1");
    const token = await createSession(w.admin.id);
    const post = (body: unknown) =>
      itemsBulk.POST(
        new Request("http://localhost:3000/api/v1/items/bulk-delete", {
          method: "POST",
          headers: {
            cookie: `${SESSION_COOKIE}=${token}`,
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({}) },
      );
    const ok = await post({ ids: [a.id] });
    expect([ok.status, await ok.json()]).toEqual([200, { deleted: ["API-1"], hidden: [], skipped: [] }]);
    expect((await post({ ids: [] })).status).toBe(422);
    expect((await post({ ids: ["not-a-uuid"] })).status).toBe(422);
  });
});
