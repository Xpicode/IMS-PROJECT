import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import * as items from "@/app/api/v1/items/route";
import * as itemsExport from "@/app/api/v1/items/export/route";
import * as issues from "@/app/api/v1/stock/issues/route";
import * as receipts from "@/app/api/v1/stock/receipts/route";
import * as lookup from "@/app/api/v1/lookup/route";
import { makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
const BASE = "http://localhost:3000";

async function call(
  h: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>,
  o: { method?: string; path: string; token: string; body?: unknown; key?: string },
) {
  const headers: Record<string, string> = { cookie: `${SESSION_COOKIE}=${o.token}` };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.method && o.method !== "GET") headers.origin = BASE;
  if (o.key) headers["idempotency-key"] = o.key;
  const res = await h(
    new Request(BASE + o.path, {
      method: o.method ?? "GET",
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    }),
    {
      params: Promise.resolve({}),
    },
  );
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body: body as Record<string, never>, headers: res.headers };
}

async function setup() {
  const whA = await makeLocation("WH-A");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const admin = await makeUser("ADMIN");
  const sup = await makeUser("SUPERVISOR", [{ id: whA.id }]);
  const field = await makeUser("FIELD", [{ id: whA.id }]);
  return {
    whA,
    pcs,
    admin: await createSession(admin.id),
    sup: await createSession(sup.id),
    field: await createSession(field.id),
  };
}

describe("stock API", () => {
  it("creates an item, receives stock with an Idempotency-Key, and replays a retry", async () => {
    const s = await setup();
    const it1 = await call(items.POST, {
      method: "POST",
      path: "/api/v1/items",
      token: s.sup,
      body: { sku: "ppe-1", name: "Gloves", unitId: s.pcs.id, trackingType: "STOCK" },
    });
    expect(it1.status).toBe(201);
    const key = randomUUID();
    const body = { locationId: s.whA.id, lines: [{ itemId: it1.body.id, quantity: 10 }] };
    const r1 = await call(receipts.POST, { method: "POST", path: "/api/v1/stock/receipts", token: s.sup, body, key });
    const r2 = await call(receipts.POST, { method: "POST", path: "/api/v1/stock/receipts", token: s.sup, body, key });
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r2.headers.get("idempotent-replay")).toBe("true");
    expect(r2.body.reference).toBe(r1.body.reference);
    expect(await prisma.stockTransaction.count()).toBe(1);
  });

  it("requires an Idempotency-Key on confirms", async () => {
    const s = await setup();
    const r = await call(receipts.POST, {
      method: "POST",
      path: "/api/v1/stock/receipts",
      token: s.sup,
      body: { locationId: s.whA.id, lines: [] },
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("A22: a field user finalizing a stock issue through the API is denied and the balance is unchanged", async () => {
    const s = await setup();
    const it1 = await call(items.POST, {
      method: "POST",
      path: "/api/v1/items",
      token: s.admin,
      body: { sku: "PPE-2", name: "Masks", unitId: s.pcs.id, trackingType: "STOCK" },
    });
    await call(receipts.POST, {
      method: "POST",
      path: "/api/v1/stock/receipts",
      token: s.admin,
      body: { locationId: s.whA.id, lines: [{ itemId: it1.body.id, quantity: 8 }] },
      key: randomUUID(),
    });
    const r = await call(issues.POST, {
      method: "POST",
      path: "/api/v1/stock/issues",
      token: s.field,
      key: randomUUID(),
      body: {
        locationId: s.whA.id,
        recipientName: "Me",
        purpose: "Because",
        lines: [{ itemId: it1.body.id, quantity: 8 }],
      },
    });
    expect(r.status).toBe(403);
    const b = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: it1.body.id } });
    expect(b.quantity).toBe(8);
  });

  it("returns 409 with a plain message when stock is short", async () => {
    const s = await setup();
    const it1 = await call(items.POST, {
      method: "POST",
      path: "/api/v1/items",
      token: s.admin,
      body: { sku: "PPE-3", name: "Boots", unitId: s.pcs.id, trackingType: "STOCK" },
    });
    const r = await call(issues.POST, {
      method: "POST",
      path: "/api/v1/stock/issues",
      token: s.sup,
      key: randomUUID(),
      body: { locationId: s.whA.id, recipientName: "A", purpose: "B", lines: [{ itemId: it1.body.id, quantity: 1 }] },
    });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      code: "INSUFFICIENT_STOCK",
      message: expect.stringMatching(/^Only 0 pcs of Boots left at WH-A/),
    });
  });

  it("looks up a typed code and exports items as escaped CSV", async () => {
    const s = await setup();
    await call(items.POST, {
      method: "POST",
      path: "/api/v1/items",
      token: s.admin,
      body: { sku: "EVIL-1", name: '=HYPERLINK("x")', unitId: s.pcs.id, trackingType: "STOCK" },
    });
    const l = await call(lookup.GET, { path: "/api/v1/lookup?code=evil-1", token: s.field });
    expect(l.body).toMatchObject({ type: "item", href: expect.stringMatching(/^\/stock\/items\//) });
    const csv = await call(itemsExport.GET, { path: "/api/v1/items/export", token: s.sup });
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(String(csv.body)).toContain(`"'=HYPERLINK(""x"")"`);
    expect((await call(itemsExport.GET, { path: "/api/v1/items/export", token: s.field })).status).toBe(403);
  });
});
