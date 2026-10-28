import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { receiveStock } from "@/lib/inventory/stock";
import * as counts from "@/app/api/v1/counts/route";
import * as mine from "@/app/api/v1/counts/mine/route";
import * as bootstrap from "@/app/api/v1/sync/bootstrap/route";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
const BASE = "http://localhost:3000";

async function call(
  h: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>,
  o: { method?: string; path: string; token: string; body?: unknown },
) {
  const headers: Record<string, string> = { cookie: `${SESSION_COOKIE}=${o.token}` };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.method && o.method !== "GET") headers.origin = BASE;
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
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, never> };
}

async function setup() {
  const wh = await makeLocation("WH-A");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const adminRow = await makeUser("ADMIN");
  const admin = (await loadAccessUser(adminRow.id))!;
  const sup = await makeUser("SUPERVISOR", [{ id: wh.id }]);
  const field = await makeUser("FIELD", [{ id: wh.id }]);
  const item = await createItem(admin, { sku: "PPE-1", name: "Gloves", unitId: pcs.id, trackingType: "STOCK" }, ctx());
  await receiveStock(admin, { locationId: wh.id, lines: [{ itemId: item.id, quantity: 5 }] }, ctx(), randomUUID());
  return { wh, field, sup: await createSession(sup.id), fieldTok: await createSession(field.id) };
}

describe("counts API", () => {
  it("supervisor creates a count; the assigned field user sees and downloads it without caching", async () => {
    const s = await setup();
    const c = await call(counts.POST, {
      method: "POST",
      path: "/api/v1/counts",
      token: s.sup,
      body: { name: "Q4", locationId: s.wh.id, assigneeIds: [s.field.id] },
    });
    expect(c.status).toBe(201);
    const m = await call(mine.GET, { path: "/api/v1/counts/mine", token: s.fieldTok });
    expect(m.body.data).toEqual([expect.objectContaining({ id: c.body.id, targetCount: 1 })]);
    const b = await call(bootstrap.GET, { path: `/api/v1/sync/bootstrap?sessionId=${c.body.id}`, token: s.fieldTok });
    expect(b.status).toBe(200);
    expect(b.headers.get("cache-control")).toBe("no-store");
    expect((b.body.targets as unknown[]).length).toBe(1);
  });

  it("field users can't create counts (403) and get 404 for sessions that aren't theirs", async () => {
    const s = await setup();
    const denied = await call(counts.POST, {
      method: "POST",
      path: "/api/v1/counts",
      token: s.fieldTok,
      body: { name: "X", locationId: s.wh.id },
    });
    expect(denied.status).toBe(403);
    const c = await call(counts.POST, {
      method: "POST",
      path: "/api/v1/counts",
      token: s.sup,
      body: { name: "Q4", locationId: s.wh.id, assigneeIds: [] },
    });
    const b = await call(bootstrap.GET, { path: `/api/v1/sync/bootstrap?sessionId=${c.body.id}`, token: s.fieldTok });
    expect(b.status).toBe(404);
    expect(
      (await call(bootstrap.GET, { path: "/api/v1/sync/bootstrap?sessionId=nope", token: s.fieldTok })).status,
    ).toBe(422);
  });
});
