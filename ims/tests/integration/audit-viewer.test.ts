import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { receiveStock } from "@/lib/inventory/stock";
import { listAudit } from "@/lib/audit/viewer";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

describe("audit log viewer", () => {
  it("hides only known routine actions before pagination/count and retains the full history", async () => {
    const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    const routine = [
      "auth.signed_in",
      "auth.signed_out",
      "borrowing.drafted",
      "count.submitted",
      "count.approved_matching",
      "count.created",
      "count.assignees_changed",
      "item.photo_changed",
      "company.logo_changed",
      "document.redrawn",
      "report.exported",
    ];
    const important = [
      "auth.login_failed",
      "auth.locked",
      "auth.forbidden",
      "count.submit_denied",
      "sync.operation_reused",
      "stock.received",
      "user.updated",
      "borrowing.photo_changed",
      "future.new_action",
    ];
    const recordId = randomUUID();
    await prisma.auditEvent.createMany({
      data: [...routine, ...important].map((eventType, i) => ({
        eventType,
        actorId: admin.id,
        recordType: "test",
        recordId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    });
    const first = await listAudit(admin, { pageSize: 3 });
    const second = await listAudit(admin, { pageSize: 3, page: 2 });
    expect(first.total).toBe(important.length);
    expect(first.pageCount).toBe(3);
    expect(second.total).toBe(first.total);
    expect(second.rows).toHaveLength(3);
    expect(second.rows.every((r) => !first.rows.some((f) => f.id === r.id))).toBe(true);
    expect((await listAudit(admin, {})).rows.map((r) => r.eventType).sort()).toEqual(important.sort());
    expect((await listAudit(admin, { view: "all" })).total).toBe(routine.length + important.length);
    expect((await listAudit(admin, { eventType: "count" })).rows.map((r) => r.eventType).sort()).toEqual(
      [...routine, ...important].filter((t) => t.startsWith("count")).sort(),
    );
    expect((await listAudit(admin, { recordId })).total).toBe(routine.length + important.length);
    expect((await listAudit(admin, { userId: admin.id, from: "2026-01-01", to: "2026-01-01" })).total).toBe(
      important.length,
    );
    expect((await listAudit(admin, { to: "2000-01-01" })).total).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(routine.length + important.length);
  });

  it("lists events newest first with who did it, filterable by user, event, record and date; admins only", async () => {
    const wh = await makeLocation("WH-A");
    const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
    const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;
    const item = await createItem(sup, { sku: "PPE-1", name: "Gloves", unitId: pcs.id }, ctx());
    await receiveStock(admin, { locationId: wh.id, lines: [{ itemId: item.id, quantity: 5 }] }, ctx(), randomUUID());

    const all = await listAudit(admin, {});
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(all.rows[0].createdAt >= all.rows.at(-1)!.createdAt).toBe(true);
    const bySup = await listAudit(admin, { userId: sup.id });
    expect(bySup.rows.length).toBeGreaterThan(0);
    expect(bySup.rows.every((r) => r.actor?.name === sup.name)).toBe(true);
    const ev = all.rows.find((r) => r.recordId === item.id)!;
    expect((await listAudit(admin, { recordId: item.id })).rows.map((r) => r.id)).toContain(ev.id);
    expect(
      (await listAudit(admin, { eventType: ev.eventType.split(".")[0] })).rows.every((r) =>
        r.eventType.startsWith(ev.eventType.split(".")[0]),
      ),
    ).toBe(true);
    expect((await listAudit(admin, { to: "2000-01-01" })).total).toBe(0);
    await expect(listAudit(sup, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
