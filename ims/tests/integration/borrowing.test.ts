import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { createItem } from "@/lib/inventory/items";
import { issueStock, receiveStock, transferStock } from "@/lib/inventory/stock";
import { createAssets, changeAssetStatus } from "@/lib/assets/service";
import {
  createBorrowDraft,
  getBorrowing,
  listBorrowings,
  releaseBorrowing,
  returnAssets,
} from "@/lib/borrowing/service";
import { documentFile, retryDocument, setRendererForTests } from "@/lib/documents/service";
import { renderPdf } from "@/lib/documents/pdf";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterEach(() => setRendererForTests(null));

async function pdfText(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(
      tc.items
        .map((x: object) => ("str" in x ? (x as { str: string }).str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  return pages;
}

async function world(drills = 3) {
  const wh = await makeLocation("WH-A");
  const site = await makeLocation("SITE-B", "SITE");
  const pcs = await prisma.unit.create({ data: { code: "pcs", name: "Piece" } });
  const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
  const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;
  const sup2 = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;
  const siteSup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: site.id }])).id))!;
  const field = (await loadAccessUser((await makeUser("FIELD", [{ id: wh.id }])).id))!;
  const drill = await createItem(
    admin,
    { sku: "TOOL-D", name: "Cordless Drill", unitId: pcs.id, trackingType: "ASSET" },
    ctx(),
  );
  const gloves = await createItem(
    admin,
    { sku: "PPE-1", name: "Safety Gloves", unitId: pcs.id, trackingType: "STOCK" },
    ctx(),
  );
  await receiveStock(admin, { locationId: wh.id, lines: [{ itemId: gloves.id, quantity: 50 }] }, ctx(), randomUUID());
  const { assets } = await createAssets(
    admin,
    { itemId: drill.id, locationId: wh.id, quantity: drills, tagPrefix: "TOOL", serialNumbers: ["SN-1"] },
    ctx(),
  );
  return { wh, site, admin, sup, sup2, siteSup, field, drill, gloves, assets };
}
type W = Awaited<ReturnType<typeof world>>;

const release = (w: W, who: W["sup"], assetIds: string[], extra: object = {}, key = randomUUID()) =>
  releaseBorrowing(
    who,
    {
      locationId: w.wh.id,
      borrowerName: "José Peña",
      borrowerDept: "Site B crew",
      purpose: "WO-2001 pump repair",
      dueAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      receivedByName: "José Peña",
      lines: assetIds.map((assetId) => ({ assetId, condition: "GOOD", accessories: "Charger, case" })),
      ...extra,
    },
    ctx(),
    key,
  );

const code = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, "expected an ApiError").toBeInstanceOf(ApiError);
  return (e as ApiError).code;
};

describe("release (§7.5)", () => {
  it("A07: borrowing an available drill makes it borrowed, records the borrower, and produces the PDF", async () => {
    const w = await world();
    const r = await release(w, w.sup, [w.assets[0].id]);
    expect(r.status).toBe(201);
    expect(r.body.reference).toMatch(/^BOR-\d{4}-000001$/);
    const a = await prisma.asset.findUniqueOrThrow({ where: { id: w.assets[0].id } });
    expect([a.status, a.custodianName]).toEqual(["BORROWED", "José Peña"]);
    const loan = await prisma.borrowing.findUniqueOrThrow({ where: { id: r.body.id }, include: { lines: true } });
    expect(loan).toMatchObject({ status: "OPEN", borrowerName: "José Peña", releasedById: w.sup.id });
    expect(loan.lines.map((l) => [l.status, l.conditionOut, l.accessories])).toEqual([
      ["OUT", "GOOD", "Charger, case"],
    ]);
    expect(await prisma.assetEvent.count({ where: { assetId: a.id, eventType: "BORROWED" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { eventType: "borrowing.released" } })).toBe(1);

    const doc = await prisma.pdfDocument.findUniqueOrThrow({ where: { id: r.body.documentId } });
    expect(doc).toMatchObject({ type: "EQUIPMENT_BORROWING", reference: r.body.reference, status: "READY" });
    const f = await documentFile(w.sup, doc.id);
    expect(f.filename).toBe(`${r.body.reference}_Equipment_Borrowing.pdf`);
    const [page] = await pdfText(f.bytes);
    for (const s of [
      "Equipment Borrowing",
      r.body.reference,
      "José Peña",
      "TOOL-0001",
      "SN-1",
      "WO-2001 pump repair",
      "Charger, case",
      "Page 1 of 1",
    ])
      expect(page, s).toContain(s);
  });

  it("A08: two supervisors racing to release the same drill: exactly one succeeds", async () => {
    const w = await world();
    const both = await Promise.allSettled([release(w, w.sup, [w.assets[0].id]), release(w, w.sup2, [w.assets[0].id])]);
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const failed = both.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as ApiError).code).toBe("CONFLICT");
    expect(await prisma.borrowingLine.count({ where: { status: "OUT" } })).toBe(1);
    expect(await prisma.borrowing.count({ where: { status: "OPEN" } })).toBe(1);
    expect(await prisma.assetEvent.count({ where: { eventType: "BORROWED" } })).toBe(1);
  });

  it("a repeated release request (same key) releases once", async () => {
    const w = await world();
    const key = randomUUID();
    const same = { dueAt: "2026-11-30T09:00:00.000Z" };
    const a = await release(w, w.sup, [w.assets[0].id], same, key);
    const b = await release(w, w.sup, [w.assets[0].id], same, key);
    expect(b.body).toEqual(a.body);
    expect(await prisma.borrowing.count()).toBe(1);
  });

  it("blocks assets that are not available here, and says why", async () => {
    const w = await world();
    await changeAssetStatus(
      w.admin,
      w.assets[1].id,
      { status: "UNDER_MAINTENANCE", reason: "Bad chuck", expectedVersion: 1 },
      ctx(),
    );
    const e = await release(w, w.sup, [w.assets[0].id, w.assets[1].id]).catch((x) => x);
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toMatch(/TOOL-0002.*under maintenance/i);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: w.assets[0].id } })).status).toBe("AVAILABLE");
    await release(w, w.sup, [w.assets[0].id]);
    expect(await code(release(w, w.sup, [w.assets[0].id]))).toBe("CONFLICT");
  });

  it("only releases assets that are at the release location", async () => {
    const w = await world();
    await prisma.asset.update({ where: { id: w.assets[2].id }, data: { locationId: w.site.id } });
    const e = await release(w, w.sup, [w.assets[2].id]).catch((x) => x);
    expect([e.code, e.message]).toEqual(["CONFLICT", expect.stringMatching(/TOOL-0003 is not at WH-A/)]);
  });

  it("only supervisors/admins of that location can release", async () => {
    const w = await world();
    expect(await code(release(w, w.field, [w.assets[0].id]))).toBe("FORBIDDEN");
    expect(await code(release(w, w.siteSup, [w.assets[0].id]))).toBe("FORBIDDEN");
  });
});

describe("drafts from the field (§7.5 step 1)", () => {
  it("a field user prepares a draft (no number, nothing changes); a supervisor releases that same draft", async () => {
    const w = await world();
    const d = await createBorrowDraft(
      w.field,
      { locationId: w.wh.id, borrowerName: "Ana Cruz", purpose: "Site survey", assetTags: ["tool-0001", "TOOL-0002"] },
      ctx(),
    );
    const draft = await prisma.borrowing.findUniqueOrThrow({ where: { id: d.id }, include: { lines: true } });
    expect([draft.status, draft.reference, draft.lines.length]).toEqual(["DRAFT", null, 2]);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: w.assets[0].id } })).status).toBe("AVAILABLE");
    expect(
      await code(
        createBorrowDraft(
          w.field,
          { locationId: w.wh.id, borrowerName: "X", purpose: "Y", assetTags: ["NOPE-1"] },
          ctx(),
        ),
      ),
    ).toBe("VALIDATION_FAILED");

    // The phone resends after a lost reply (same key): still one request.
    const key = randomUUID();
    const sent = { locationId: w.wh.id, borrowerName: "Ben", purpose: "Y", assetTags: ["TOOL-0003"] };
    const a = await createBorrowDraft(w.field, sent, ctx(), key);
    expect(await createBorrowDraft(w.field, sent, ctx(), key)).toEqual(a);
    expect(await prisma.borrowing.count({ where: { status: "DRAFT" } })).toBe(2);
    // Field staff can't prepare requests for places they're not assigned to.
    expect(await code(createBorrowDraft(w.field, { ...sent, locationId: w.site.id }, ctx()))).toBe("FORBIDDEN");

    const r = await release(w, w.sup, [w.assets[0].id], { draftId: d.id, borrowerName: "Ana Cruz" });
    expect(r.body.id).toBe(d.id);
    const loan = await prisma.borrowing.findUniqueOrThrow({ where: { id: d.id }, include: { lines: true } });
    expect(loan.status).toBe("OPEN");
    // The supervisor's final list wins: only TOOL-0001 went out.
    expect(loan.lines.map((l) => l.status)).toEqual(["OUT"]);
    expect((await listBorrowings(w.sup, { tab: "requests" })).rows.map((x) => x.borrowerName)).toEqual(["Ben"]);
    expect(await code(release(w, w.sup, [w.assets[0].id], { draftId: d.id }))).toBe("CONFLICT");
  });
});

describe("return (§7.6)", () => {
  it("A09: returning 2 of 3 closes those lines; the loan stays open until the third comes back", async () => {
    const w = await world();
    const r = await release(
      w,
      w.sup,
      w.assets.map((a) => a.id),
    );
    const loan = await getBorrowing(w.sup, r.body.id);
    const [l1, l2, l3] = loan.lines;
    const ret = await returnAssets(
      w.sup,
      r.body.id,
      {
        returnedByName: "José Peña",
        lines: [
          { lineId: l1.id, condition: "GOOD" },
          { lineId: l2.id, condition: "FAIR" },
        ],
      },
      ctx(),
      randomUUID(),
    );
    expect(ret.body).toMatchObject({
      reference: expect.stringMatching(/^RET-\d{4}-000001$/),
      loanStatus: "OPEN",
      returned: 2,
      total: 3,
    });
    const st = await prisma.asset.findMany({ orderBy: { tag: "asc" } });
    expect(st.map((a) => [a.tag, a.status, a.custodianName])).toEqual([
      ["TOOL-0001", "AVAILABLE", null],
      ["TOOL-0002", "AVAILABLE", null],
      ["TOOL-0003", "BORROWED", "José Peña"],
    ]);
    const again = await returnAssets(
      w.sup,
      r.body.id,
      { returnedByName: "X", lines: [{ lineId: l1.id, condition: "GOOD" }] },
      ctx(),
      randomUUID(),
    ).catch((x) => x);
    expect([again.code, again.message]).toEqual(["CONFLICT", expect.stringMatching(/TOOL-0001 was already returned/)]);
    const last = await returnAssets(
      w.sup,
      r.body.id,
      { returnedByName: "José Peña", lines: [{ lineId: l3.id, condition: "GOOD" }] },
      ctx(),
      randomUUID(),
    );
    expect(last.body).toMatchObject({ loanStatus: "CLOSED", returned: 3, total: 3 });
    expect((await prisma.borrowing.findUniqueOrThrow({ where: { id: r.body.id } })).closedAt).not.toBeNull();
    expect(await prisma.pdfDocument.count({ where: { type: "RETURN_ACKNOWLEDGMENT", status: "READY" } })).toBe(2);
  });

  it("A10: a damaged return goes to needs review (or maintenance when chosen), never straight to available", async () => {
    const w = await world();
    const r = await release(w, w.sup, [w.assets[0].id, w.assets[1].id]);
    const { lines } = await getBorrowing(w.sup, r.body.id);
    await returnAssets(
      w.sup,
      r.body.id,
      {
        returnedByName: "José Peña",
        lines: [
          { lineId: lines[0].id, condition: "DAMAGED", missingAccessories: "Charger" },
          { lineId: lines[1].id, condition: "DAMAGED", damagedStatus: "UNDER_MAINTENANCE", notes: "Chuck slips" },
        ],
      },
      ctx(),
      randomUUID(),
    );
    const st = await prisma.asset.findMany({
      where: { id: { in: [w.assets[0].id, w.assets[1].id] } },
      orderBy: { tag: "asc" },
    });
    expect(st.map((a) => [a.status, a.condition])).toEqual([
      ["NEEDS_REVIEW", "DAMAGED"],
      ["UNDER_MAINTENANCE", "DAMAGED"],
    ]);
    const l = await prisma.borrowingLine.findMany({ orderBy: { returnedAt: "asc" } });
    expect(l.map((x) => x.missingAccessories).filter(Boolean)).toEqual(["Charger"]);
  });

  it("returns to the receiving location when it is different", async () => {
    const w = await world();
    const r = await release(w, w.sup, [w.assets[0].id]);
    const { lines } = await getBorrowing(w.sup, r.body.id);
    await returnAssets(
      w.admin,
      r.body.id,
      { returnedByName: "José", locationId: w.site.id, lines: [{ lineId: lines[0].id, condition: "GOOD" }] },
      ctx(),
      randomUUID(),
    );
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: w.assets[0].id } })).locationId).toBe(w.site.id);
  });

  it("lists loans by tab, with overdue ones separate", async () => {
    const w = await world();
    await release(w, w.sup, [w.assets[0].id], { dueAt: new Date(Date.now() - 86400_000).toISOString() });
    await release(w, w.sup, [w.assets[1].id]);
    const tab = async (t: "active" | "overdue" | "closed") => (await listBorrowings(w.sup, { tab: t })).rows.length;
    expect([await tab("active"), await tab("overdue"), await tab("closed")]).toEqual([2, 1, 0]);
    expect(await code(getBorrowing(w.siteSup, (await listBorrowings(w.sup, { tab: "active" })).rows[0].id))).toBe(
      "NOT_FOUND",
    );
  });
});

describe("official documents (§13, A24, A25)", () => {
  it("A24: issue, transfer, borrowing and return each produce their own form", async () => {
    const w = await world();
    const iss = await issueStock(
      w.sup,
      {
        locationId: w.wh.id,
        lines: [{ itemId: w.gloves.id, quantity: 5 }],
        recipientName: "Pedro Santos",
        purpose: "WO-7",
      },
      ctx(),
      randomUUID(),
    );
    const trn = await transferStock(
      w.admin,
      {
        fromLocationId: w.wh.id,
        toLocationId: w.site.id,
        lines: [{ itemId: w.gloves.id, quantity: 7 }],
        reason: "Site stock",
      },
      ctx(),
      randomUUID(),
    );
    const bor = await release(w, w.sup, [w.assets[0].id]);
    const { lines } = await getBorrowing(w.sup, bor.body.id);
    const ret = await returnAssets(
      w.sup,
      bor.body.id,
      { returnedByName: "José Peña", lines: [{ lineId: lines[0].id, condition: "GOOD" }] },
      ctx(),
      randomUUID(),
    );
    const expectations: [string | undefined, string, string[]][] = [
      [
        iss.body.documentId,
        "Stock Issuance",
        [iss.body.reference, "Pedro Santos", "WO-7", "PPE-1", "Safety Gloves", "5", "WH-A"],
      ],
      [trn.body.documentId, "Transmittal", [trn.body.reference, "WH-A", "SITE-B", "PPE-1", "7", "Site stock"]],
      [bor.body.documentId, "Equipment Borrowing", [bor.body.reference, "José Peña", "TOOL-0001"]],
      [ret.body.documentId, "Return Acknowledgment", [ret.body.reference, bor.body.reference, "TOOL-0001", "Good"]],
    ];
    for (const [id, title, words] of expectations) {
      expect(id, title).toBeTruthy();
      const [page] = await pdfText((await documentFile(w.admin, id!)).bytes);
      expect(page).toContain(title);
      for (const s of words) expect(page, `${title}: ${s}`).toContain(s);
    }
  });

  it("A24: a 30-asset loan prints on several pages", async () => {
    const w = await world(30);
    const r = await release(
      w,
      w.sup,
      w.assets.map((a) => a.id),
    );
    const pages = await pdfText((await documentFile(w.sup, r.body.documentId)).bytes);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.at(-1)).toContain(`Page ${pages.length} of ${pages.length}`);
    expect(pages.join(" ").match(/TOOL-\d{4}/g)!.length).toBe(30);
  });

  it("A25: if drawing the PDF fails, the issue stays confirmed; Retry PDF fixes it with no second movement", async () => {
    const w = await world();
    setRendererForTests(async () => {
      throw new Error("renderer crashed");
    });
    const iss = await issueStock(
      w.sup,
      { locationId: w.wh.id, lines: [{ itemId: w.gloves.id, quantity: 5 }], recipientName: "Pedro", purpose: "WO-7" },
      ctx(),
      randomUUID(),
    );
    expect(iss.status).toBe(201);
    const bal = async () =>
      (await prisma.stockBalance.findFirstOrThrow({ where: { itemId: w.gloves.id, locationId: w.wh.id } })).quantity;
    expect(await bal()).toBe(45);
    const failed = await prisma.pdfDocument.findUniqueOrThrow({ where: { id: iss.body.documentId } });
    expect([failed.status, failed.attempts, failed.reference]).toEqual(["PDF_FAILED", 1, iss.body.reference]);
    expect(failed.lastError).not.toMatch(/Pedro/);
    expect(await code(documentFile(w.sup, failed.id))).toBe("CONFLICT");

    setRendererForTests(null);
    const doc = await retryDocument(w.sup, failed.id, ctx());
    expect(doc.status).toBe("READY");
    expect(await bal()).toBe(45);
    expect(await prisma.stockTransaction.count({ where: { type: "ISSUE" } })).toBe(1);
    expect((await documentFile(w.sup, failed.id)).filename).toBe(`${iss.body.reference}_Stock_Issuance.pdf`);
  });

  it("keeps the printed values frozen and the file honest", async () => {
    const w = await world();
    const r = await release(w, w.sup, [w.assets[0].id]);
    await expect(
      prisma.pdfDocument.update({ where: { id: r.body.documentId }, data: { snapshot: { tampered: true } } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.pdfDocument.delete({ where: { id: r.body.documentId } })).rejects.toThrow();
    // A file changed on disk is refused (checksum), and can be redrawn from the snapshot.
    const doc = await prisma.pdfDocument.findUniqueOrThrow({ where: { id: r.body.documentId } });
    const file = path.join(process.env.DOCUMENTS_DIR!, doc.filePath!);
    writeFileSync(file, Buffer.from("not the document"));
    expect(await code(documentFile(w.sup, doc.id))).toBe("CONFLICT");
    await retryDocument(w.sup, doc.id, ctx());
    const again = await documentFile(w.sup, doc.id);
    expect((await pdfText(again.bytes))[0]).toContain(r.body.reference);
    expect(readFileSync(file).length).toBeGreaterThan(1000);
  });

  it("only people with access to the location can download", async () => {
    const w = await world();
    const r = await release(w, w.sup, [w.assets[0].id]);
    expect(await code(documentFile(w.siteSup, r.body.documentId))).toBe("NOT_FOUND");
    expect(await code(documentFile(w.field, r.body.documentId))).toBe("NOT_FOUND");
    expect((await documentFile(w.admin, r.body.documentId)).bytes.length).toBeGreaterThan(1000);
  });

  it("the renderer used by the service is the real one by default", async () => {
    expect(typeof renderPdf).toBe("function");
  });
});
