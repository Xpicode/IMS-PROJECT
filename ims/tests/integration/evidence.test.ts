import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { loadAccessUser } from "@/lib/users/access";
import { uploadEvidence, viewEvidence } from "@/lib/evidence";
import { pushOperations } from "@/lib/counts/sync";
import { createCountSession } from "@/lib/counts/service";
import { createItem } from "@/lib/inventory/items";
import { createAssets } from "@/lib/assets/service";
import { releaseBorrowing, returnAssets, getBorrowing } from "@/lib/borrowing/service";
import { createSession } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import * as route from "@/app/api/v1/evidence/[id]/route";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
async function world() {
  const loc = await makeLocation("WH");
  const other = await makeLocation("OTHER");
  const unit = await prisma.unit.create({ data: { code: "pcs", name: "Pieces" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const field = (await loadAccessUser((await makeUser("FIELD", [{ id: loc.id }])).id))!;
  const outsider = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: other.id }])).id))!;
  const item = await createItem(admin, { sku: "ASSET", name: "Asset", unitId: unit.id, trackingType: "ASSET" }, ctx());
  const { assets } = await createAssets(
    admin,
    { itemId: item.id, locationId: loc.id, quantity: 2, tagPrefix: "TOOL" },
    ctx(),
  );
  const session = await createCountSession(
    admin,
    { name: "Count", locationId: loc.id, assigneeIds: [field.id], includeStock: false, includeAssets: true },
    ctx(),
  );
  const targets = await prisma.countSessionItem.findMany({ where: { sessionId: session.id } });
  return { loc, admin, field, outsider, assets, session, targets };
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e.code,
  );

it("uploads are immutable, replayable, target/owner/location checked, and private", async () => {
  const w = await world();
  const id = randomUUID();
  const target = { kind: "COUNT" as const, targetId: w.targets[0].id };
  expect(await uploadEvidence(w.field, id, target, PNG)).toEqual({ id });
  expect(await uploadEvidence(w.field, id, target, PNG)).toEqual({ id });
  expect(await prisma.evidencePhoto.count()).toBe(1);
  expect(await code(uploadEvidence(w.field, id, target, Buffer.concat([PNG, Buffer.from("different")])))).toBe(
    "CONFLICT",
  );
  expect(await code(uploadEvidence(w.field, id, { ...target, targetId: w.targets[1].id }, PNG))).toBe("CONFLICT");
  expect(await code(uploadEvidence(w.outsider, randomUUID(), target, PNG))).toBe("NOT_FOUND");
  expect(await code(viewEvidence(w.outsider, id))).toBe("NOT_FOUND");
  const anonymous = await route.GET(new Request(`http://localhost/api/v1/evidence/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(anonymous.status).toBe(401);
  const outsiderToken = await createSession(w.outsider.id);
  const denied = await route.GET(
    new Request(`http://localhost/api/v1/evidence/${id}`, {
      headers: { cookie: `${SESSION_COOKIE}=${outsiderToken}` },
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(denied.status).toBe(404);
  expect(await code(uploadEvidence(w.field, randomUUID(), target, Uint8Array.from([255, 216, 255, 0])))).toBe(
    "VALIDATION_FAILED",
  );
  expect(await code(uploadEvidence(w.field, randomUUID(), target, Buffer.from("<svg/>")))).toBe("VALIDATION_FAILED");
  expect(await code(uploadEvidence(w.field, randomUUID(), target, new Uint8Array(2097153)))).toBe("VALIDATION_FAILED");
  const token = await createSession(w.field.id);
  const response = await route.GET(
    new Request(`http://localhost/api/v1/evidence/${id}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
});

it("counts retry until photos exist, hash associations, and retain superseded evidence", async () => {
  const w = await world();
  const id = randomUUID();
  const op = {
    operationId: randomUUID(),
    type: "SUBMIT_COUNT",
    sessionId: w.session.id,
    targetId: w.targets[0].id,
    baseVersion: 1,
    payload: { found: true, condition: "GOOD", evidenceIds: [id] },
  };
  const push = (operation = op) => pushOperations(w.field, { deviceId: "test", operations: [operation] }, ctx());
  expect((await push()).results[0].status).toBe("RETRYABLE_ERROR");
  expect(await prisma.countEntry.count()).toBe(0);
  await uploadEvidence(w.field, id, { kind: "COUNT", targetId: op.targetId }, PNG);
  const first = await push();
  expect(first.results[0].status).toBe("ACKED");
  const wrongTarget = { ...op, operationId: randomUUID(), targetId: w.targets[1].id };
  expect((await push(wrongTarget)).results[0]).toMatchObject({ status: "REJECTED", code: "FORBIDDEN" });
  expect(
    (await push({ ...op, operationId: randomUUID(), payload: { ...op.payload, evidenceIds: [id, id] } })).results[0]
      .status,
  ).toBe("REJECTED");
  expect((await push()).results).toEqual(first.results);
  expect(await prisma.countEntryPhoto.count()).toBe(1);
  expect((await push({ ...op, payload: { ...op.payload, evidenceIds: [] } })).results[0].status).toBe("REJECTED");
  await push({ ...op, operationId: randomUUID(), payload: { ...op.payload, evidenceIds: [] } });
  expect((await prisma.countEntry.findFirstOrThrow({ where: { operationId: op.operationId } })).status).toBe(
    "SUPERSEDED",
  );
  expect((await viewEvidence(w.admin, id)).bytes).toEqual(PNG);
  await expect(prisma.countEntryPhoto.deleteMany()).rejects.toThrow();
});

it("partial returns attach photos only to the returned line and reject cross-line evidence", async () => {
  const w = await world();
  const loan = await releaseBorrowing(
    w.admin,
    {
      locationId: w.loc.id,
      borrowerName: "Borrower",
      purpose: "Work",
      lines: w.assets.map((a) => ({ assetId: a.id, condition: "GOOD" })),
    },
    ctx(),
    randomUUID(),
  );
  const lines = await prisma.borrowingLine.findMany({ where: { borrowingId: loan.body.id }, orderBy: { id: "asc" } });
  const id = randomUUID();
  await uploadEvidence(w.admin, id, { kind: "RETURN", targetId: lines[0].id, locationId: w.loc.id }, PNG);
  expect(
    await code(
      returnAssets(
        w.admin,
        loan.body.id,
        { returnedByName: "Borrower", lines: [{ lineId: lines[1].id, condition: "GOOD", evidenceIds: [id] }] },
        ctx(),
        randomUUID(),
      ),
    ),
  ).toBe("FORBIDDEN");
  const key = randomUUID();
  const input = {
    returnedByName: "Borrower",
    lines: [{ lineId: lines[0].id, condition: "GOOD" as const, evidenceIds: [id] }],
  };
  const first = await returnAssets(w.admin, loan.body.id, input, ctx(), key);
  expect((await returnAssets(w.admin, loan.body.id, input, ctx(), key)).body).toEqual(first.body);
  const saved = await getBorrowing(w.admin, loan.body.id);
  expect(saved.status).toBe("OPEN");
  expect(saved.lines.find((l) => l.id === lines[0].id)?.photos).toEqual([{ photoId: id }]);
  expect(saved.lines.find((l) => l.id === lines[1].id)?.photos).toEqual([]);
  expect(await code(viewEvidence(w.outsider, id))).toBe("NOT_FOUND");
});
