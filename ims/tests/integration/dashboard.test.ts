import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { issueStock, receiveStock } from "@/lib/inventory/stock";
import { createBorrowDraft, releaseBorrowing } from "@/lib/borrowing/service";
import { createCountSession } from "@/lib/counts/service";
import { pushOperations } from "@/lib/counts/sync";
import { approveLine } from "@/lib/counts/review";
import { setRendererForTests } from "@/lib/documents/service";
import { dashboardData, needsAction, recentActivity } from "@/lib/inventory/dashboard";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

describe("dashboard: needs your action (§4.3)", () => {
  it("lists real work with counts and links, only for my locations", async () => {
    const wh = await makeLocation("WH-A");
    const site = await makeLocation("SITE-B", "SITE");
    const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
    const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;
    const siteSup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: site.id }])).id))!;
    const field = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id))!;
    const gloves = await createItem(admin, { sku: "PPE-1", name: "Gloves", unitId: pcs.id }, ctx());
    const drill = await createItem(admin, { sku: "TOOL-D", name: "Drill", unitId: pcs.id }, ctx());
    await receiveStock(
      admin,
      {
        locationId: wh.id,
        lines: [
          { itemId: gloves.id, quantity: 10 },
          { itemId: drill.id, quantity: 5 },
        ],
      },
      ctx(),
      randomUUID(),
    );

    expect(await needsAction(sup)).toEqual([]);

    // 1 overdue loan; a loan that isn't due yet is not overdue.
    // (Released before the count opens: an item in an open count can't be lent.)
    await releaseBorrowing(
      sup,
      {
        locationId: wh.id,
        borrowerName: "Ben",
        purpose: "y",
        dueAt: new Date(Date.now() - 86400_000).toISOString(),
        lines: [{ itemId: drill.id, quantity: 1 }],
      },
      ctx(),
      randomUUID(),
    );
    await releaseBorrowing(
      sup,
      {
        locationId: wh.id,
        borrowerName: "Cy",
        purpose: "z",
        dueAt: new Date(Date.now() + 86400_000).toISOString(),
        lines: [{ itemId: drill.id, quantity: 2 }],
      },
      ctx(),
      randomUUID(),
    );

    // 1 count with a counted line waiting for review
    // (one line already decided must not be counted)
    const ties = await createItem(admin, { sku: "ELC-1", name: "Ties", unitId: pcs.id }, ctx());
    await receiveStock(admin, { locationId: wh.id, lines: [{ itemId: ties.id, quantity: 4 }] }, ctx(), randomUUID());
    const s = await createCountSession(sup, { name: "Q4", locationId: wh.id, assigneeIds: [field.id] }, ctx());
    const targets = await prisma.countSessionItem.findMany({ where: { sessionId: s.id }, include: { item: true } });
    const send = (targetId: string, quantity: number) =>
      pushOperations(
        field,
        {
          deviceId: "d",
          operations: [
            {
              operationId: randomUUID(),
              type: "SUBMIT_COUNT",
              sessionId: s.id,
              targetId,
              baseVersion: 1,
              clientRecordedAt: new Date().toISOString(),
              payload: { quantity },
            },
          ],
        },
        ctx(),
      );
    const tGloves = targets.find((x) => x.item.sku === "PPE-1")!;
    const tTies = targets.find((x) => x.item.sku === "ELC-1")!;
    await send(tGloves.id, 9);
    await send(tTies.id, 4);
    await approveLine(sup, s.id, tTies.id, {}, ctx(), randomUUID());
    // 1 request to release, 1 failed PDF
    await createBorrowDraft(
      field,
      { locationId: wh.id, borrowerName: "Ana", purpose: "x", lines: [{ code: "TOOL-D", quantity: 1 }] },
      ctx(),
    );
    setRendererForTests(async () => {
      throw new Error("x");
    });
    try {
      await issueStock(
        sup,
        {
          locationId: wh.id,
          lines: [{ itemId: gloves.id, quantity: 1 }],
          recipientName: "P",
          purpose: "q",
          countException: { reason: "Urgent job" },
        },
        ctx(),
        randomUUID(),
      );
    } finally {
      setRendererForTests(null);
    }

    const a = await needsAction(sup);
    const byKind = Object.fromEntries(a.map((x) => [x.kind, x]));
    expect(byKind.countReview).toMatchObject({ count: 1, href: `/counts/${s.id}` });
    expect(byKind.borrowRequests).toMatchObject({ count: 1, href: "/borrowing?tab=requests" });
    expect(byKind.overdueLoans).toMatchObject({ count: 1, href: "/borrowing?tab=overdue" });
    expect(byKind.failedPdfs).toMatchObject({ count: 1, href: "/documents?status=PDF_FAILED" });
    for (const x of a) expect(x.text).toMatch(/\d/);

    expect(await needsAction(siteSup)).toEqual([]);
    expect((await needsAction(admin)).length).toBe(4);
    expect(await dashboardData(sup)).toMatchObject({ openLoans: 2, overdueLoans: 1 });
    expect(await dashboardData(siteSup)).toMatchObject({ openLoans: 0, overdueLoans: 0 });

    const recent = await recentActivity(sup);
    expect(recent.rows[0]).toMatchObject({ reference: expect.stringMatching(/^ISS-/) });
    expect(recent.rows.find((r) => String(r.reference).startsWith("BOR-"))?.what).toMatch(
      /^Lent \d+ Drill to (Ben|Cy)$/,
    );
    expect((await recentActivity(siteSup)).rows).toEqual([]);

    // Pages: newest first across stock moves, loans and returns, no repeats, total counts all three.
    const p1 = await recentActivity(sup, { page: 1, pageSize: 2 });
    const p2 = await recentActivity(sup, { page: 2, pageSize: 2 });
    expect(p1.total).toBe(recent.total);
    expect(p1.pageCount).toBe(Math.ceil(recent.total / 2));
    expect([...p1.rows, ...p2.rows].map((r) => r.reference)).toEqual(recent.rows.slice(0, 4).map((r) => r.reference));
  });
});

describe("dashboard numbers", () => {
  it("flags low/out only for items with a low-stock level, so never-stocked catalog items aren't noise", async () => {
    const wh = await makeLocation("WH-A");
    const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
    const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    const watchedOut = await createItem(
      admin,
      { sku: "A-OUT", name: "Watched, none left", unitId: pcs.id, minStock: 5 },
      ctx(),
    );
    const watchedLow = await createItem(
      admin,
      { sku: "A-LOW", name: "Watched, low", unitId: pcs.id, minStock: 5 },
      ctx(),
    );
    await createItem(admin, { sku: "Z-NEVER", name: "Catalog only", unitId: pcs.id }, ctx());
    await receiveStock(
      admin,
      { locationId: wh.id, lines: [{ itemId: watchedLow.id, quantity: 3 }] },
      ctx(),
      randomUUID(),
    );
    const d = await dashboardData(admin);
    expect([d.low, d.out]).toEqual([1, 1]);
    expect(d.attention.map((r) => r.sku).sort()).toEqual(["A-LOW", "A-OUT"]);
    expect(d.attention.find((r) => r.id === watchedOut.id)?.stockStatus).toBe("OUT");
  });
});
