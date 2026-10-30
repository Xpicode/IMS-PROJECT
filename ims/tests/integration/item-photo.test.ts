import { beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { itemPhoto, removeItemPhoto, setItemPhoto } from "@/lib/inventory/item-photo";
import { createSession } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import * as photoRoute from "@/app/api/v1/items/[id]/photo/route";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

// Smallest valid images: the server checks the file's first bytes, not its name.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

async function world() {
  const wh = await makeLocation("WH-A");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const field = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id))!;
  const item = await createItem(admin, { sku: "LAP-1", name: "Laptop", unitId: pcs.id, trackingType: "ASSET" }, ctx());
  return { admin, field, item };
}
const fileOf = (p: string) => path.join(process.env.DOCUMENTS_DIR!, p);
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e as ApiError).code,
  );

describe("item photo", () => {
  it("stores a photo, serves it back to viewers, and replaces the old file on change", async () => {
    const w = await world();
    await setItemPhoto(w.admin, w.item.id, PNG, ctx());
    const first = (await prisma.item.findUniqueOrThrow({ where: { id: w.item.id } })).photoPath!;
    expect(first).toMatch(/^item-photos\/.+\.png$/);
    const got = await itemPhoto(w.field, w.item.id);
    expect([got.type, Buffer.from(got.bytes).equals(Buffer.from(PNG))]).toEqual(["image/png", true]);

    await setItemPhoto(w.admin, w.item.id, JPEG, ctx());
    const second = (await prisma.item.findUniqueOrThrow({ where: { id: w.item.id } })).photoPath!;
    expect(second).toMatch(/\.jpg$/);
    expect([existsSync(fileOf(first)), existsSync(fileOf(second))]).toEqual([false, true]);
    expect(await prisma.auditEvent.count({ where: { eventType: "item.photo_changed" } })).toBe(2);

    await removeItemPhoto(w.admin, w.item.id, ctx());
    expect((await prisma.item.findUniqueOrThrow({ where: { id: w.item.id } })).photoPath).toBeNull();
    expect(existsSync(fileOf(second))).toBe(false);
    expect(await code(itemPhoto(w.field, w.item.id))).toBe("NOT_FOUND");
  });

  it("refuses files that aren't JPEG, PNG or WebP, files over 2 MB, and field users", async () => {
    const w = await world();
    expect(await code(setItemPhoto(w.admin, w.item.id, new TextEncoder().encode("<svg onload=alert(1)>"), ctx()))).toBe(
      "VALIDATION_FAILED",
    );
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(JPEG.subarray(0, 4));
    expect(await code(setItemPhoto(w.admin, w.item.id, big, ctx()))).toBe("VALIDATION_FAILED");
    expect(await code(setItemPhoto(w.field, w.item.id, PNG, ctx()))).toBe("FORBIDDEN");
    expect((await prisma.item.findUniqueOrThrow({ where: { id: w.item.id } })).photoPath).toBeNull();
  });

  it("uploads and downloads through the API", async () => {
    const w = await world();
    const token = await createSession(w.admin.id);
    const call = (method: string, body?: Uint8Array) =>
      photoRoute[method as "PUT" | "GET"](
        new Request(`http://localhost:3000/api/v1/items/${w.item.id}/photo`, {
          method,
          headers: {
            cookie: `${SESSION_COOKIE}=${token}`,
            ...(body ? { "content-type": "image/png", origin: "http://localhost:3000" } : {}),
          },
          body: body ? Buffer.from(body) : undefined,
        }),
        { params: Promise.resolve({ id: w.item.id }) },
      );
    expect((await call("PUT", PNG)).status).toBe(200);
    const res = await call("GET");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG))).toBe(true);
  });
});
