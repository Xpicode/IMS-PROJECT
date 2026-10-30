import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { writeAudit } from "@/lib/audit";
import { withIdempotency } from "@/lib/idempotency";
import { loadAccessUser } from "@/lib/users/access";
import { createSession, resolveSession, deleteSession } from "@/lib/auth/sessions";
import { verifyCredentials } from "@/lib/auth/credentials";
import { createUser, updateUser, listUsers, issuePasswordReset, resetPasswordWithToken } from "@/lib/users/service";
import { listLocations, getLocation, createLocation } from "@/lib/locations/service";
import { ctx, makeLocation, makeUser, resetDb, TEST_PASSWORD } from "./helpers";

beforeEach(resetDb);

async function expectApiError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err, `expected ApiError ${code}`).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
}

describe("audit trail", () => {
  it("is append-only at the database level", async () => {
    const ev = await writeAudit(prisma, { actorId: null, eventType: "test.event", requestId: "r1" });
    await expect(prisma.auditEvent.update({ where: { id: ev.id }, data: { eventType: "tampered" } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });
});

describe("effective locations", () => {
  it("includes child locations of an assigned parent, keeping the stronger access", async () => {
    const wh = await makeLocation("WH-A");
    const rack = await makeLocation("WH-A-R1", "AREA", wh.id);
    const bin = await makeLocation("WH-A-R1-B1", "AREA", rack.id);
    const other = await makeLocation("SITE-B", "SITE");
    const u = await makeUser("SUPERVISOR", [
      { id: wh.id, access: "VIEW_ONLY" },
      { id: rack.id, access: "FULL" },
    ]);
    const au = await loadAccessUser(u.id);
    const byId = Object.fromEntries(au!.locations.map((l) => [l.id, l.access]));
    expect(byId).toEqual({ [wh.id]: "VIEW_ONLY", [rack.id]: "FULL", [bin.id]: "FULL" });
    expect(byId[other.id]).toBeUndefined();
  });
});

describe("sessions and credentials", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const u = await makeUser("FIELD", [], { email: "juan@test.local" });
    expect(await verifyCredentials(" JUAN@test.local ", TEST_PASSWORD)).toEqual({ id: u.id });
    expect(await verifyCredentials("juan@test.local", "wrong-password-1")).toBeNull();
    expect(await verifyCredentials("nobody@test.local", TEST_PASSWORD)).toBeNull();
  });

  it("refuses to sign in a deactivated account, saying so only when the password is right", async () => {
    await makeUser("FIELD", [], { email: "gone@test.local", status: "INACTIVE" });
    expect(await verifyCredentials("gone@test.local", TEST_PASSWORD)).toEqual({ inactive: true });
    expect(await verifyCredentials("gone@test.local", "wrong-password-1")).toBeNull();
  });

  it("stores only a hash of the session token and ends it on logout", async () => {
    const u = await makeUser("ADMIN");
    const token = await createSession(u.id);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.tokenHash).not.toContain(token);
    expect((await resolveSession(token))?.userId).toBe(u.id);
    await deleteSession(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const u = await makeUser("ADMIN");
    const token = await createSession(u.id);
    await prisma.session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveSession(token)).toBeNull();
  });
});

describe("users service", () => {
  it("lets an admin create a user, normalizing the email and writing an audit event", async () => {
    const admin = await loadAccessUser((await makeUser("ADMIN")).id);
    const wh = await makeLocation("WH-A");
    const c = ctx();
    const created = await createUser(
      admin!,
      {
        name: "Maria Santos",
        email: "  Maria@Example.COM ",
        password: "A-long-password-1",
        role: "SUPERVISOR",
        locations: [{ id: wh.id, access: "FULL" }],
      },
      c,
    );
    expect(created.email).toBe("maria@example.com");
    expect(created).not.toHaveProperty("passwordHash");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: "user.created" } });
    expect(audit.recordId).toBe(created.id);
    expect(audit.requestId).toBe(c.requestId);
    expect(JSON.stringify(audit.after)).not.toMatch(/password/i);
  });

  it("rejects a duplicate email", async () => {
    const admin = await loadAccessUser((await makeUser("ADMIN")).id);
    await makeUser("FIELD", [], { email: "dup@test.local" });
    await expectApiError(
      createUser(
        admin!,
        { name: "X", email: "DUP@test.local", password: "A-long-password-1", role: "FIELD", locations: [] },
        ctx(),
      ),
      "DUPLICATE",
    );
  });

  it("forbids a supervisor from creating users and writes nothing", async () => {
    const wh = await makeLocation("WH-A");
    const sup = await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id);
    const before = await prisma.user.count();
    await expectApiError(
      createUser(
        sup!,
        { name: "X", email: "x@test.local", password: "A-long-password-1", role: "ADMIN", locations: [] },
        ctx(),
      ),
      "FORBIDDEN",
    );
    expect(await prisma.user.count()).toBe(before);
  });

  it("ends every session when a user is deactivated or their role changes", async () => {
    const admin = await loadAccessUser((await makeUser("ADMIN")).id);
    const target = await makeUser("SUPERVISOR");
    const t1 = await createSession(target.id);
    await updateUser(admin!, target.id, { role: "FIELD" }, ctx());
    expect(await resolveSession(t1)).toBeNull();

    const t2 = await createSession(target.id);
    await updateUser(admin!, target.id, { status: "INACTIVE" }, ctx());
    expect(await resolveSession(t2)).toBeNull();
    const ev = await prisma.auditEvent.findMany({ where: { recordId: target.id }, orderBy: { createdAt: "asc" } });
    expect(ev.map((e) => e.eventType)).toEqual(["user.updated", "user.updated"]);
  });

  it("does not let an admin deactivate themselves or remove their own admin role", async () => {
    const me = await loadAccessUser((await makeUser("ADMIN")).id);
    await expectApiError(updateUser(me!, me!.id, { status: "INACTIVE" }, ctx()), "CONFLICT");
    await expectApiError(updateUser(me!, me!.id, { role: "FIELD" }, ctx()), "CONFLICT");
  });

  it("lists users for admins only", async () => {
    const admin = await loadAccessUser((await makeUser("ADMIN")).id);
    const field = await loadAccessUser((await makeUser("FIELD")).id);
    expect((await listUsers(admin!)).length).toBe(2);
    await expectApiError(listUsers(field!), "FORBIDDEN");
  });

  it("resets a password with a single-use, time-limited link", async () => {
    const admin = await loadAccessUser((await makeUser("ADMIN")).id);
    const target = await makeUser("FIELD", [], { email: "reset@test.local" });
    const session = await createSession(target.id);
    const { token, expiresAt } = await issuePasswordReset(admin!, target.id, ctx());
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    await resetPasswordWithToken(token, "Brand-new-password-2", ctx());
    expect(await verifyCredentials("reset@test.local", "Brand-new-password-2")).not.toBeNull();
    expect(await verifyCredentials("reset@test.local", TEST_PASSWORD)).toBeNull();
    expect(await resolveSession(session)).toBeNull();
    await expectApiError(resetPasswordWithToken(token, "Another-password-3", ctx()), "NOT_FOUND");
  });
});

describe("locations service", () => {
  it("hides another site's location from a field user (A23)", async () => {
    const mine = await makeLocation("SITE-B", "SITE");
    const theirs = await makeLocation("WH-A");
    const field = await loadAccessUser((await makeUser("FIELD", [{ id: mine.id }])).id);
    expect((await listLocations(field!)).map((l) => l.code)).toEqual(["SITE-B"]);
    await expectApiError(getLocation(field!, theirs.id), "NOT_FOUND");
    expect((await getLocation(field!, mine.id)).code).toBe("SITE-B");
  });

  it("lets a supervisor add a child under an assigned location but not a top-level one", async () => {
    const wh = await makeLocation("WH-A");
    const sup = await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id);
    const rack = await createLocation(sup!, { code: "wh-a-r1", name: "Rack 1", type: "AREA", parentId: wh.id }, ctx());
    expect(rack.code).toBe("WH-A-R1");
    await expectApiError(createLocation(sup!, { code: "NEW", name: "New", type: "SITE" }, ctx()), "FORBIDDEN");
  });

  it("forbids field users from creating locations", async () => {
    const wh = await makeLocation("WH-A");
    const field = await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id);
    await expectApiError(
      createLocation(field!, { code: "X", name: "X", type: "AREA", parentId: wh.id }, ctx()),
      "FORBIDDEN",
    );
  });
});

describe("withIdempotency", () => {
  it("returns the stored result for a repeated key and runs the work once", async () => {
    const u = await makeUser("ADMIN");
    const key = randomUUID();
    let runs = 0;
    const work = async () => {
      runs++;
      return { status: 201, body: { ok: true, n: runs } };
    };
    const a = await withIdempotency({ userId: u.id, key, scope: "POST /x", payload: { q: 1 } }, work);
    const b = await withIdempotency({ userId: u.id, key, scope: "POST /x", payload: { q: 1 } }, work);
    expect(runs).toBe(1);
    expect(b).toEqual({ ...a, replayed: true });
  });

  it("rejects the same key with a different payload without running the work", async () => {
    const u = await makeUser("ADMIN");
    const key = randomUUID();
    await withIdempotency({ userId: u.id, key, scope: "POST /x", payload: { q: 1 } }, async () => ({
      status: 201,
      body: {},
    }));
    await expectApiError(
      withIdempotency({ userId: u.id, key, scope: "POST /x", payload: { q: 2 } }, async () => {
        throw new Error("must not run");
      }),
      "IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("stores nothing when the work fails, so a retry runs again", async () => {
    const u = await makeUser("ADMIN");
    const key = randomUUID();
    await expect(
      withIdempotency({ userId: u.id, key, scope: "POST /x", payload: {} }, async () => {
        throw new ApiError("CONFLICT", "nope");
      }),
    ).rejects.toThrow("nope");
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it("runs concurrent duplicates only once", async () => {
    const u = await makeUser("ADMIN");
    const key = randomUUID();
    let runs = 0;
    const work = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 50));
      return { status: 201, body: { ok: true } };
    };
    const results = await Promise.all(
      [1, 2, 3].map(() => withIdempotency({ userId: u.id, key, scope: "POST /x", payload: {} }, work)),
    );
    expect(runs).toBe(1);
    expect(results.filter((r) => r.replayed).length).toBe(2);
  });
});

describe("database connection", () => {
  // Prisma loads a query's relations in parallel; inside a transaction they share one
  // connection. pg queues overlapping queries today but deprecates it (removed in pg 9).
  it("sends a transaction's queries one at a time", async () => {
    const wh = await makeLocation("WH-Q");
    const rack = await makeLocation("WH-Q-R1", "AREA", wh.id);
    await makeLocation("WH-Q-R1-B1", "AREA", rack.id);

    // Count queries sent while another one on the same connection hasn't finished.
    const orig = pg.Client.prototype.query;
    const inFlight = new WeakMap<object, number>();
    let overlaps = 0;
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const n = inFlight.get(this) ?? 0;
      if (n > 0) overlaps++;
      inFlight.set(this, n + 1);
      const r = (orig as (...a: unknown[]) => unknown).apply(this, args);
      const done = () => inFlight.set(this, (inFlight.get(this) ?? 1) - 1);
      if (r instanceof Promise) r.then(done, done);
      else done();
      return r;
    } as typeof orig;
    try {
      const got = await prisma.$transaction((tx) =>
        tx.location.findUnique({ where: { id: rack.id }, include: { parent: true, children: true } }),
      );
      expect(got?.parent?.code).toBe("WH-Q");
      expect(got?.children.map((c) => c.code)).toEqual(["WH-Q-R1-B1"]);
    } finally {
      pg.Client.prototype.query = orig;
    }
    expect(overlaps).toBe(0);
  });
});
