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
  it("lists events newest first with who did it, filterable by user, event, record and date; admins only", async () => {
    const wh = await makeLocation("WH-A");
    const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
    const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;
    const item = await createItem(sup, { sku: "PPE-1", name: "Gloves", unitId: pcs.id, trackingType: "STOCK" }, ctx());
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
