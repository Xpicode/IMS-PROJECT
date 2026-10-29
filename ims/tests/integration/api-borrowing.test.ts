import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { createAssets } from "@/lib/assets/service";
import * as release from "@/app/api/v1/borrowings/release/route";
import * as preview from "@/app/api/v1/borrowings/preview/route";
import * as pdf from "@/app/api/v1/documents/[id]/pdf/route";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
const BASE = "http://localhost:3000";

function req(path: string, token: string, o: { method?: string; body?: unknown; key?: string } = {}) {
  const headers: Record<string, string> = { cookie: `${SESSION_COOKIE}=${token}` };
  if (o.method && o.method !== "GET") headers.origin = BASE;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.key) headers["idempotency-key"] = o.key;
  return new Request(BASE + path, {
    method: o.method ?? "GET",
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
}

describe("borrowing + documents API", () => {
  it("releases with an Idempotency-Key, serves the PDF privately, and previews a DRAFT", async () => {
    const wh = await makeLocation("WH-A");
    const other = await makeLocation("WH-Z");
    const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
    const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    const sup = await makeUser("SUPERVISOR", [{ id: wh.id }]);
    const otherSup = await makeUser("SUPERVISOR", [{ id: other.id }]);
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
    const tok = await createSession(sup.id);
    const body = {
      locationId: wh.id,
      borrowerName: "Ana",
      purpose: "Job",
      lines: [{ assetId: assets[0].id, condition: "GOOD" }],
    };

    const pv = await preview.POST(req("/api/v1/borrowings/preview", tok, { method: "POST", body }), {
      params: Promise.resolve({}),
    });
    expect(pv.status).toBe(200);
    expect(pv.headers.get("content-type")).toBe("application/pdf");
    expect(await prisma.borrowing.count()).toBe(0);

    expect(
      (
        await release.POST(req("/api/v1/borrowings/release", tok, { method: "POST", body }), {
          params: Promise.resolve({}),
        })
      ).status,
    ).toBe(400);
    const r = await release.POST(req("/api/v1/borrowings/release", tok, { method: "POST", body, key: randomUUID() }), {
      params: Promise.resolve({}),
    });
    expect(r.status).toBe(201);
    const { documentId, reference } = (await r.json()) as { documentId: string; reference: string };

    const get = (token: string, q = "") =>
      pdf.GET(req(`/api/v1/documents/${documentId}/pdf${q}`, token), { params: Promise.resolve({ id: documentId }) });
    const ok = await get(tok, "?download=1");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("content-disposition")).toBe(`attachment; filename="${reference}_Equipment_Borrowing.pdf"`);
    expect(
      Buffer.from(await ok.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    expect((await get(await createSession(otherSup.id))).status).toBe(404);
    expect((await get("not-a-session")).status).toBe(401);
  });
});
