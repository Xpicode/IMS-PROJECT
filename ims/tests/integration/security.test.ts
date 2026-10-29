import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { randomUUID } from "node:crypto";
import { verifyCredentials, LOGIN_LOCK } from "@/lib/auth/credentials";
import { createSession } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { loadAccessUser } from "@/lib/users/access";
import { createItem, listItems } from "@/lib/inventory/items";
import { listAssets, createAssets } from "@/lib/assets/service";
import { runReport } from "@/lib/reports/service";
import { releaseBorrowing } from "@/lib/borrowing/service";
import { documentFile } from "@/lib/documents/service";
import * as locations from "@/app/api/v1/locations/route";
import { ctx, makeLocation, makeUser, resetDb, TEST_PASSWORD } from "./helpers";

beforeEach(resetDb);
const later = (min: number) => new Date(Date.now() + min * 60_000);

describe("sign-in throttling (§16, ASVS 2.2)", () => {
  it("locks an email for 15 minutes after 5 wrong passwords, even for the right password, and audits each failure", async () => {
    await makeUser("FIELD", [], { email: "juan@test.local" });
    for (let i = 0; i < LOGIN_LOCK.attempts; i++)
      expect(await verifyCredentials("juan@test.local", `wrong-${i}`)).toBeNull();
    expect(await verifyCredentials("JUAN@test.local", TEST_PASSWORD)).toEqual({ locked: true });
    const ev = await prisma.auditEvent.findMany({ where: { eventType: "auth.login_failed" } });
    expect(ev).toHaveLength(LOGIN_LOCK.attempts);
    expect(JSON.stringify(ev)).not.toMatch(/wrong-|juan@test/); // no passwords, no plain email
    expect(await prisma.auditEvent.count({ where: { eventType: "auth.login_locked" } })).toBe(1);
    // After the window it works again.
    expect(await verifyCredentials("juan@test.local", TEST_PASSWORD, later(16))).toMatchObject({
      id: expect.any(String),
    });
  });

  it("locks unknown emails the same way, so the lock doesn't reveal which accounts exist", async () => {
    for (let i = 0; i < LOGIN_LOCK.attempts; i++) await verifyCredentials("nobody@test.local", "x");
    expect(await verifyCredentials("nobody@test.local", "y")).toEqual({ locked: true });
  });

  it("a successful sign-in resets the count", async () => {
    await makeUser("FIELD", [], { email: "ana@test.local" });
    for (let i = 0; i < LOGIN_LOCK.attempts - 1; i++) await verifyCredentials("ana@test.local", "bad");
    expect(await verifyCredentials("ana@test.local", TEST_PASSWORD)).toMatchObject({ id: expect.any(String) });
    for (let i = 0; i < LOGIN_LOCK.attempts - 1; i++) await verifyCredentials("ana@test.local", "bad");
    expect(await verifyCredentials("ana@test.local", TEST_PASSWORD)).toMatchObject({ id: expect.any(String) });
  });

  it("one person's failures don't lock someone else", async () => {
    await makeUser("FIELD", [], { email: "ben@test.local" });
    for (let i = 0; i < LOGIN_LOCK.attempts; i++) await verifyCredentials("bob@test.local", "x"); // same length as ben@
    expect(await verifyCredentials("ben@test.local", TEST_PASSWORD)).toMatchObject({ id: expect.any(String) });
  });
});

describe("cross-site requests (CSRF, §16)", () => {
  const post = async (token: string, headers: Record<string, string>, code: string) =>
    locations.POST(
      new Request("http://localhost:3000/api/v1/locations", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json", ...headers },
        body: JSON.stringify({ code, name: code, type: "SITE" }),
      }),
      { params: Promise.resolve({}) },
    );

  it("blocks a browser's cross-site request even when it sends no Origin header", async () => {
    const admin = await makeUser("ADMIN");
    const tok = await createSession(admin.id);
    const r = await post(tok, { "sec-fetch-site": "cross-site" }, "X1");
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("BAD_ORIGIN");
    expect(await prisma.location.count({ where: { code: "X1" } })).toBe(0);
    expect((await post(tok, { "sec-fetch-site": "same-origin" }, "X2")).status).toBe(201);
  });
});

describe("injection in search and filters", () => {
  it("treats SQL and wildcard characters in search as plain text", async () => {
    const wh = await makeLocation("WH-A");
    const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
    const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    const item = await createItem(
      admin,
      { sku: "PPE-1", name: "Gloves", unitId: pcs.id, trackingType: "ASSET" },
      ctx(),
    );
    await createItem(admin, { sku: "PPE-2", name: "100% cotton rag", unitId: pcs.id, trackingType: "STOCK" }, ctx());
    await createAssets(admin, { itemId: item.id, locationId: wh.id, quantity: 2, tagPrefix: "TOOL" }, ctx());
    for (const q of ["'; DROP TABLE items; --", "\\", "_", "%' OR '1'='1"]) {
      expect((await listItems(admin, { q })).rows, q).toHaveLength(0);
      expect((await listAssets(admin, { q })).rows, q).toHaveLength(0);
      expect((await runReport(admin, "assets", { q })).rows, q).toHaveLength(0);
    }
    // "%" is a real character people search for, not "match everything".
    expect((await listItems(admin, { q: "%" })).rows.map((r) => r.sku)).toEqual(["PPE-2"]);
    expect((await runReport(admin, "stock-balances", { q: "_" })).rows).toHaveLength(0);
    expect(await prisma.item.count()).toBe(2);
  });
});

describe("stored PDF paths", () => {
  it("refuses a document whose stored path points outside the private folder", async () => {
    const wh = await makeLocation("WH-A");
    const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
    const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    const drill = await createItem(
      admin,
      { sku: "TOOL-D", name: "Drill", unitId: pcs.id, trackingType: "ASSET" },
      ctx(),
    );
    const { assets } = await createAssets(
      admin,
      { itemId: drill.id, locationId: wh.id, quantity: 1, tagPrefix: "TOOL" },
      ctx(),
    );
    const r = await releaseBorrowing(
      admin,
      { locationId: wh.id, borrowerName: "A", purpose: "B", lines: [{ assetId: assets[0].id, condition: "GOOD" }] },
      ctx(),
      randomUUID(),
    );
    await prisma.pdfDocument.update({ where: { id: r.body.documentId }, data: { filePath: "../../package.json" } });
    await expect(documentFile(admin, r.body.documentId)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/stored PDF/i),
    });
  });
});
