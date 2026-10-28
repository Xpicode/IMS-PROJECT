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
import * as syncPush from "@/app/api/v1/sync/push/route";
import * as approve from "@/app/api/v1/counts/[id]/lines/[lineId]/approve/route";
import * as review from "@/app/api/v1/counts/[id]/review/route";
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

describe("sync push API", () => {
  it("accepts a count from the assigned device user, never cacheable, and refuses other sites' requests", async () => {
    const s = await setup();
    const c = await call(counts.POST, {
      method: "POST",
      path: "/api/v1/counts",
      token: s.sup,
      body: { name: "Q4", locationId: s.wh.id, assigneeIds: [s.field.id] },
    });
    const b = await call(bootstrap.GET, { path: `/api/v1/sync/bootstrap?sessionId=${c.body.id}`, token: s.fieldTok });
    const t = (b.body.targets as unknown as { id: string }[])[0];
    const op = {
      operationId: randomUUID(),
      type: "SUBMIT_COUNT",
      sessionId: c.body.id,
      targetId: t.id,
      baseVersion: 1,
      payload: { quantity: 4, notes: "" },
    };
    const body = { deviceId: "dev-1", operations: [op] };
    const r = await call(syncPush.POST, { method: "POST", path: "/api/v1/sync/push", token: s.fieldTok, body });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body.results).toEqual([expect.objectContaining({ operationId: op.operationId, status: "ACKED" })]);
    expect(Date.parse(r.body.serverTime)).toBeGreaterThan(0);

    const signedOut = await call(syncPush.POST, { method: "POST", path: "/api/v1/sync/push", token: "nope", body });
    expect(signedOut.status).toBe(401);
    const res = await syncPush.POST(
      new Request(BASE + "/api/v1/sync/push", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${s.fieldTok}`,
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
    expect(await prisma.countEntry.count()).toBe(1);
  });
});

describe("review API", () => {
  it("approves a line once per Idempotency-Key and hides the review from field users", async () => {
    const s = await setup();
    const c = await call(counts.POST, {
      method: "POST",
      path: "/api/v1/counts",
      token: s.sup,
      body: { name: "Q4", locationId: s.wh.id, assigneeIds: [s.field.id] },
    });
    const b = await call(bootstrap.GET, { path: `/api/v1/sync/bootstrap?sessionId=${c.body.id}`, token: s.fieldTok });
    const t = (b.body.targets as unknown as { id: string }[])[0];
    await call(syncPush.POST, {
      method: "POST",
      path: "/api/v1/sync/push",
      token: s.fieldTok,
      body: {
        deviceId: "d",
        operations: [
          {
            operationId: randomUUID(),
            type: "SUBMIT_COUNT",
            sessionId: c.body.id,
            targetId: t.id,
            baseVersion: 1,
            payload: { quantity: 3 },
          },
        ],
      },
    });
    const params = Promise.resolve({ id: c.body.id as string, lineId: t.id });
    const post = (key?: string) =>
      approve.POST(
        new Request(`${BASE}/api/v1/counts/${c.body.id}/lines/${t.id}/approve`, {
          method: "POST",
          headers: {
            cookie: `${SESSION_COOKIE}=${s.sup}`,
            origin: BASE,
            "content-type": "application/json",
            ...(key ? { "idempotency-key": key } : {}),
          },
          body: "{}",
        }),
        { params },
      );
    expect((await post()).status).toBe(400);
    const key = randomUUID();
    const first = await post(key);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { variance: number }).variance).toBe(-2);
    const again = await post(key);
    expect(again.headers.get("idempotent-replay")).toBe("true");
    expect(await prisma.stockTransaction.count({ where: { type: "ADJUSTMENT" } })).toBe(1);

    const fieldReview = await review.GET(
      new Request(`${BASE}/api/v1/counts/${c.body.id}/review`, {
        headers: { cookie: `${SESSION_COOKIE}=${s.fieldTok}` },
      }),
      { params: Promise.resolve({ id: c.body.id as string }) },
    );
    expect(fieldReview.status).toBe(403);
    expect(JSON.stringify(await fieldReview.json())).not.toMatch(/expected/);
  });
});
