/**
 * API-level permission checks. These call the real Route Handlers with a real
 * session cookie against the test database: no mocks.
 * Covers the first steps of A22 (field user blocked by the API) and A23
 * (field user cannot read another site's records).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import * as me from "@/app/api/v1/me/route";
import * as users from "@/app/api/v1/users/route";
import * as userById from "@/app/api/v1/users/[id]/route";
import * as locations from "@/app/api/v1/locations/route";
import * as locationById from "@/app/api/v1/locations/[id]/route";
import * as health from "@/app/api/health/route";
import { makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const BASE = "http://localhost:3000";

async function call(
  handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  opts: {
    method?: string;
    path: string;
    token?: string;
    body?: unknown;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  },
) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.cookie = `${SESSION_COOKIE}=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.method && opts.method !== "GET") headers.origin ??= BASE;
  const req = new Request(BASE + opts.path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function setup() {
  const siteB = await makeLocation("SITE-B", "SITE");
  const whA = await makeLocation("WH-A");
  const admin = await makeUser("ADMIN");
  const field = await makeUser("FIELD", [{ id: siteB.id }]);
  return {
    siteB,
    whA,
    admin,
    field,
    adminToken: await createSession(admin.id),
    fieldToken: await createSession(field.id),
  };
}

describe("API access control", () => {
  it("health check answers without a session", async () => {
    const res = await health.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
  });

  it("returns 401 with the standard error shape when signed out", async () => {
    const r = await call(me.GET, { path: "/api/v1/me" });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({
      code: "UNAUTHENTICATED",
      message: expect.any(String),
      requestId: expect.any(String),
    });
    expect(r.headers.get("x-request-id")).toBe(r.body.requestId);
  });

  it("GET /me returns role, locations, and permissions", async () => {
    const s = await setup();
    const r = await call(me.GET, { path: "/api/v1/me", token: s.fieldToken });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe("FIELD");
    expect(r.body.locations.map((l: { code: string }) => l.code)).toEqual(["SITE-B"]);
    expect(r.body.permissions["stock.move"]).toBe(false);
    expect(r.body.permissions["counts.perform"]).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash/);
  });

  it("A22 (first step): a field user cannot create users or locations through the API", async () => {
    const s = await setup();
    const before = await prisma.user.count();
    const r1 = await call(users.POST, {
      method: "POST",
      path: "/api/v1/users",
      token: s.fieldToken,
      body: { name: "Evil", email: "evil@test.local", password: "A-long-password-1", role: "ADMIN" },
    });
    expect(r1.status).toBe(403);
    expect(r1.body.code).toBe("FORBIDDEN");
    expect(await prisma.user.count()).toBe(before);

    const r2 = await call(locations.POST, {
      method: "POST",
      path: "/api/v1/locations",
      token: s.fieldToken,
      body: { code: "X1", name: "X", type: "AREA", parentId: s.siteB.id },
    });
    expect(r2.status).toBe(403);

    const denied = await prisma.auditEvent.count({ where: { eventType: "auth.forbidden", actorId: s.field.id } });
    expect(denied).toBe(2);
  });

  it("A22 (first step): a field user cannot list or change users", async () => {
    const s = await setup();
    expect((await call(users.GET, { path: "/api/v1/users", token: s.fieldToken })).status).toBe(403);
    const r = await call(userById.PATCH, {
      method: "PATCH",
      path: `/api/v1/users/${s.field.id}`,
      token: s.fieldToken,
      params: { id: s.field.id },
      body: { role: "ADMIN" },
    });
    expect(r.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.field.id } })).role).toBe("FIELD");
  });

  it("A23 (first step): a field user gets 404 for another site and sees only their own in lists", async () => {
    const s = await setup();
    const r = await call(locationById.GET, {
      path: `/api/v1/locations/${s.whA.id}`,
      token: s.fieldToken,
      params: { id: s.whA.id },
    });
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain("WH-A");

    const list = await call(locations.GET, { path: "/api/v1/locations", token: s.fieldToken });
    expect(list.body.data.map((l: { code: string }) => l.code)).toEqual(["SITE-B"]);
  });

  it("ends access immediately when a user is deactivated", async () => {
    const s = await setup();
    const r = await call(userById.PATCH, {
      method: "PATCH",
      path: `/api/v1/users/${s.field.id}`,
      token: s.adminToken,
      params: { id: s.field.id },
      body: { status: "INACTIVE" },
    });
    expect(r.status).toBe(200);
    expect((await call(me.GET, { path: "/api/v1/me", token: s.fieldToken })).status).toBe(401);
  });

  it("blocks state-changing requests from another origin (CSRF)", async () => {
    const s = await setup();
    const r = await call(locations.POST, {
      method: "POST",
      path: "/api/v1/locations",
      token: s.adminToken,
      headers: { origin: "https://evil.example" },
      body: { code: "X2", name: "X", type: "SITE" },
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("BAD_ORIGIN");
    expect(await prisma.location.count({ where: { code: "X2" } })).toBe(0);
  });

  it("returns 422 with field errors for invalid input, and 400 for broken JSON", async () => {
    const s = await setup();
    const r = await call(users.POST, {
      method: "POST",
      path: "/api/v1/users",
      token: s.adminToken,
      body: { name: "", email: "not-an-email", password: "short", role: "BOSS" },
    });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.fields).sort()).toEqual(["email", "name", "password", "role"]);

    const bad = await call(users.POST, { method: "POST", path: "/api/v1/users", token: s.adminToken, body: "{oops" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_JSON");
  });

  it("returns 404 (not 500) for a malformed id", async () => {
    const s = await setup();
    const r = await call(locationById.GET, {
      path: "/api/v1/locations/abc",
      token: s.adminToken,
      params: { id: "abc" },
    });
    expect(r.status).toBe(404);
  });
});
