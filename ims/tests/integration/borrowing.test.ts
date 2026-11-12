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
import { createCountSession } from "@/lib/counts/service";
import {
  cancelBorrowDraft,
  closeBorrowing,
  createBorrowDraft,
  getBorrowing,
  listBorrowings,
  releaseBorrowing,
  returnItems,
} from "@/lib/borrowing/service";
import { documentFile, retryDocument, setRendererForTests } from "@/lib/documents/service";
import { bulkDeleteBorrowings } from "@/lib/bulk-delete";
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

async function world() {
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
    { sku: "TOOL-D", name: "Cordless Drill", unitId: pcs.id, barcode: "4006381333931" },
    ctx(),
  );
  const gloves = await createItem(admin, { sku: "PPE-1", name: "Safety Gloves", unitId: pcs.id }, ctx());
  await receiveStock(
    admin,
    {
      locationId: wh.id,
      lines: [
        { itemId: drill.id, quantity: 3 },
        { itemId: gloves.id, quantity: 50 },
      ],
    },
    ctx(),
    randomUUID(),
  );
  return { wh, site, pcs, admin, sup, sup2, siteSup, field, drill, gloves };
}
type W = Awaited<ReturnType<typeof world>>;
type Line = { itemId: string; quantity: number };

const release = (w: W, who: W["sup"], lines: Line[], extra: object = {}, key = randomUUID()) =>
  releaseBorrowing(
    who,
    {
      locationId: w.wh.id,
      borrowerName: "José Peña",
      borrowerDept: "Site B crew",
      purpose: "WO-2001 pump repair",
      dueAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      receivedByName: "José Peña",
      lines: lines.map((l) => ({ ...l, condition: "GOOD" as const, accessories: "Charger, case" })),
      ...extra,
    },
    ctx(),
    key,
  );

const giveBack = (w: W, loanId: string, lines: { lineId: string; quantity: number }[], extra: object = {}) =>
  returnItems(w.sup, loanId, { returnedByName: "José Peña", lines, ...extra }, ctx(), randomUUID());

const onHand = async (itemId: string, locationId: string) =>
  (await prisma.stockBalance.findUnique({ where: { itemId_locationId: { itemId, locationId } } }))?.quantity ?? 0;

const code = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, "expected an ApiError").toBeInstanceOf(ApiError);
  return (e as ApiError).code;
};

describe("release (§7.5)", () => {
  it("A07: a release opens the loan with a BOR- number, records the borrower, and produces the PDF", async () => {
    const w = await world();
    const r = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 2 }]);
    expect(r.status).toBe(201);
    expect(r.body.reference).toMatch(/^BOR-\d{4}-000001$/);
    expect(r.body.lines).toEqual([{ sku: "TOOL-D", quantity: 2, unit: "pcs" }]);
    const loan = await prisma.borrowing.findUniqueOrThrow({ where: { id: r.body.id }, include: { lines: true } });
    expect(loan).toMatchObject({ status: "OPEN", borrowerName: "José Peña", releasedById: w.sup.id });
    expect(loan.lines.map((l) => [l.itemId, l.quantity, l.status, l.conditionOut, l.accessories])).toEqual([
      [w.drill.id, 2, "OUT", "GOOD", "Charger, case"],
    ]);
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
      "TOOL-D",
      "Cordless Drill",
      "2 pcs",
      "WO-2001 pump repair",
      "Charger, case",
      "Page 1 of 1",
    ])
      expect(page, s).toContain(s);
  });

  it("deducts the quantity at the location with a BORROW stock move under the loan's number", async () => {
    const w = await world();
    const r = await release(w, w.sup, [
      { itemId: w.drill.id, quantity: 2 },
      { itemId: w.gloves.id, quantity: 10 },
    ]);
    expect([await onHand(w.drill.id, w.wh.id), await onHand(w.gloves.id, w.wh.id)]).toEqual([1, 40]);
    const move = await prisma.stockTransaction.findFirstOrThrow({
      where: { type: "BORROW" },
      include: { movements: true },
    });
    expect(move.reference).toBe(r.body.reference);
    expect(move.movements.map((l) => [l.itemId, l.locationId, l.quantity]).sort()).toEqual(
      [
        [w.drill.id, w.wh.id, -2],
        [w.gloves.id, w.wh.id, -10],
      ].sort(),
    );
  });

  it("refuses more than is on hand and leaves stock unchanged", async () => {
    const w = await world();
    const e = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 4 }]).catch((x) => x);
    expect([e.code, e.message]).toEqual(["INSUFFICIENT_STOCK", expect.stringMatching(/Only 3 pcs of Cordless Drill/)]);
    expect(await onHand(w.drill.id, w.wh.id)).toBe(3);
    expect(await prisma.borrowing.count()).toBe(0);
    expect(await prisma.stockTransaction.count({ where: { type: "BORROW" } })).toBe(0);
  });

  it("refuses an item that is being counted at that location", async () => {
    const w = await world();
    await createCountSession(w.admin, { name: "Q4", locationId: w.wh.id }, ctx());
    expect(await code(release(w, w.sup, [{ itemId: w.drill.id, quantity: 1 }]))).toBe("COUNT_IN_PROGRESS");
    expect(await onHand(w.drill.id, w.wh.id)).toBe(3);
  });

  it("prints a typed 'Prepared by' name, and falls back to the signed-in user when it's empty", async () => {
    const w = await world();
    const one = [{ itemId: w.drill.id, quantity: 1 }];
    const named = await release(w, w.sup, one, { preparedByName: "Maria Santos" });
    const blank = await release(w, w.sup, one);
    expect((await prisma.borrowing.findUniqueOrThrow({ where: { id: named.body.id } })).preparedByName).toBe(
      "Maria Santos",
    );
    const [p1] = await pdfText((await documentFile(w.sup, named.body.documentId)).bytes);
    const [p2] = await pdfText((await documentFile(w.sup, blank.body.documentId)).bytes);
    expect(p1).toContain("Maria Santos");
    expect(p2).toContain(w.sup.name);
  });

  it("A08: two supervisors racing to release the last units: exactly one succeeds", async () => {
    const w = await world();
    const all = [{ itemId: w.drill.id, quantity: 3 }];
    const both = await Promise.allSettled([release(w, w.sup, all), release(w, w.sup2, all)]);
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const failed = both.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as ApiError).code).toBe("INSUFFICIENT_STOCK");
    expect(await onHand(w.drill.id, w.wh.id)).toBe(0);
    expect(await prisma.borrowing.count({ where: { status: "OPEN" } })).toBe(1);
    expect(await prisma.stockTransaction.count({ where: { type: "BORROW" } })).toBe(1);
  });

  it("a repeated release request (same key) releases once and deducts once", async () => {
    const w = await world();
    const key = randomUUID();
    const same = { dueAt: "2026-11-30T09:00:00.000Z" };
    const a = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 2 }], same, key);
    const b = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 2 }], same, key);
    expect(b.body).toEqual(a.body);
    expect(await prisma.borrowing.count()).toBe(1);
    expect(await prisma.stockTransaction.count({ where: { type: "BORROW" } })).toBe(1);
    expect(await onHand(w.drill.id, w.wh.id)).toBe(1);
  });

  it("only supervisors/admins of that location can release", async () => {
    const w = await world();
    const one = [{ itemId: w.drill.id, quantity: 1 }];
    expect(await code(release(w, w.field, one))).toBe("FORBIDDEN");
    expect(await code(release(w, w.siteSup, one))).toBe("FORBIDDEN");
  });
});

describe("drafts from the field (§7.5 step 1)", () => {
  it("a field user prepares a draft (no number, stock unchanged); a supervisor releases that same draft", async () => {
    const w = await world();
    const d = await createBorrowDraft(
      w.field,
      {
        locationId: w.wh.id,
        borrowerName: "Ana Cruz",
        purpose: "Site survey",
        lines: [
          { itemId: w.gloves.id, quantity: 4 },
          { code: "tool-d", quantity: 1 }, // SKU, typed in lower case
          { code: "4006381333931", quantity: 1 }, // the drill's barcode
        ],
      },
      ctx(),
    );
    const draft = await prisma.borrowing.findUniqueOrThrow({ where: { id: d.id }, include: { lines: true } });
    expect([draft.status, draft.reference]).toEqual(["DRAFT", null]);
    // SKU and barcode both name the drill: one line with both quantities.
    expect(draft.lines.map((l) => [l.itemId, l.quantity]).sort()).toEqual(
      [
        [w.gloves.id, 4],
        [w.drill.id, 2],
      ].sort(),
    );
    expect(await onHand(w.drill.id, w.wh.id)).toBe(3);

    const r = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 1 }], {
      draftId: d.id,
      borrowerName: "Ana Cruz",
    });
    expect(r.body.id).toBe(d.id);
    const loan = await prisma.borrowing.findUniqueOrThrow({ where: { id: d.id }, include: { lines: true } });
    expect(loan.status).toBe("OPEN");
    // The supervisor's final list wins: only one drill went out.
    expect(loan.lines.map((l) => [l.itemId, l.quantity])).toEqual([[w.drill.id, 1]]);
    expect([await onHand(w.drill.id, w.wh.id), await onHand(w.gloves.id, w.wh.id)]).toEqual([2, 50]);
    expect(await code(release(w, w.sup, [{ itemId: w.drill.id, quantity: 1 }], { draftId: d.id }))).toBe("CONFLICT");
  });

  it("refuses an unknown code, resends with the same key make one request, and only for my locations", async () => {
    const w = await world();
    const unknown = await createBorrowDraft(
      w.field,
      { locationId: w.wh.id, borrowerName: "X", purpose: "Y", lines: [{ code: "NOPE-1", quantity: 1 }] },
      ctx(),
    ).catch((x) => x);
    expect([unknown.code, unknown.message]).toEqual(["VALIDATION_FAILED", expect.stringContaining("NOPE-1")]);

    // The phone resends after a lost reply (same key): still one request.
    const key = randomUUID();
    const sent = { locationId: w.wh.id, borrowerName: "Ben", purpose: "Y", lines: [{ code: "PPE-1", quantity: 2 }] };
    const a = await createBorrowDraft(w.field, sent, ctx(), key);
    expect(await createBorrowDraft(w.field, sent, ctx(), key)).toEqual(a);
    expect(await prisma.borrowing.count({ where: { status: "DRAFT" } })).toBe(1);
    expect((await listBorrowings(w.sup, { tab: "requests" })).rows.map((x) => x.borrowerName)).toEqual(["Ben"]);
    // Field staff can't prepare requests for places they're not assigned to.
    expect(await code(createBorrowDraft(w.field, { ...sent, locationId: w.site.id }, ctx()))).toBe("FORBIDDEN");
  });
});

describe("return (§7.6)", () => {
  it("A09: a partial return adds back only that quantity; the loan closes when the rest comes back", async () => {
    const w = await world();
    const r = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 3 }]);
    const [line] = (await getBorrowing(w.sup, r.body.id)).lines;

    const first = await giveBack(w, r.body.id, [{ lineId: line.id, quantity: 1 }]);
    expect(first.body).toMatchObject({
      reference: expect.stringMatching(/^RET-\d{4}-000001$/),
      loanStatus: "OPEN",
      returned: 1,
      total: 3,
    });
    expect(await onHand(w.drill.id, w.wh.id)).toBe(1);
    expect(await prisma.borrowingLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({
      returnedQuantity: 1,
      status: "OUT",
    });
    const move = await prisma.stockTransaction.findFirstOrThrow({
      where: { type: "RETURN" },
      include: { movements: true },
    });
    expect([move.reference, move.movements.map((l) => l.quantity)]).toEqual([first.body.reference, [1]]);

    const last = await giveBack(w, r.body.id, [{ lineId: line.id, quantity: 2 }]);
    expect(last.body).toMatchObject({ loanStatus: "CLOSED", returned: 3, total: 3 });
    expect(await onHand(w.drill.id, w.wh.id)).toBe(3);
    expect(await prisma.borrowingLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({
      returnedQuantity: 3,
      status: "RETURNED",
    });
    expect((await prisma.borrowing.findUniqueOrThrow({ where: { id: r.body.id } })).closedAt).not.toBeNull();
    expect(await prisma.pdfDocument.count({ where: { type: "RETURN_ACKNOWLEDGMENT", status: "READY" } })).toBe(2);
  });

  it("refuses returning more than is still out, or a line that is all back", async () => {
    const w = await world();
    const r = await release(w, w.sup, [
      { itemId: w.drill.id, quantity: 2 },
      { itemId: w.gloves.id, quantity: 5 },
    ]);
    const { lines } = await getBorrowing(w.sup, r.body.id);
    const drill = lines.find((l) => l.itemId === w.drill.id)!;
    const e = await giveBack(w, r.body.id, [{ lineId: drill.id, quantity: 3 }]).catch((x) => x);
    expect([e.code, e.message]).toEqual(["VALIDATION_FAILED", expect.stringMatching(/Only 2 pcs of Cordless Drill/)]);
    expect(await onHand(w.drill.id, w.wh.id)).toBe(1);

    await giveBack(w, r.body.id, [{ lineId: drill.id, quantity: 2 }]);
    expect(await code(giveBack(w, r.body.id, [{ lineId: drill.id, quantity: 1 }]))).toBe("CONFLICT");
    expect(await onHand(w.drill.id, w.wh.id)).toBe(3);
  });

  it("returns to the receiving location when it is different, and keeps the condition", async () => {
    const w = await world();
    const r = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 1 }]);
    const { lines } = await getBorrowing(w.sup, r.body.id);
    await returnItems(
      w.admin,
      r.body.id,
      {
        returnedByName: "José",
        locationId: w.site.id,
        lines: [{ lineId: lines[0].id, quantity: 1, condition: "DAMAGED", notes: "Chuck slips" }],
      },
      ctx(),
      randomUUID(),
    );
    expect([await onHand(w.drill.id, w.wh.id), await onHand(w.drill.id, w.site.id)]).toEqual([2, 1]);
    expect(await prisma.returnLine.findFirstOrThrow()).toMatchObject({ condition: "DAMAGED", notes: "Chuck slips" });
  });

  it("closing a loan as not returned keeps the rest deducted; supervisors only, with a real reason", async () => {
    const w = await world();
    const r = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 3 }]);
    const [line] = (await getBorrowing(w.sup, r.body.id)).lines;
    await giveBack(w, r.body.id, [{ lineId: line.id, quantity: 1 }]);

    expect(await code(closeBorrowing(w.field, r.body.id, "Lost on site", ctx()))).toBe("FORBIDDEN");
    expect(await code(closeBorrowing(w.sup, r.body.id, "  x ", ctx()))).toBe("VALIDATION_FAILED");
    const closed = await closeBorrowing(w.sup, r.body.id, "Lost on site", ctx());
    expect(closed.status).toBe("CLOSED");
    expect(await onHand(w.drill.id, w.wh.id)).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: "borrowing.closed_not_returned" } });
    expect(audit.after).toMatchObject({ reason: "Lost on site", notReturned: [{ sku: "TOOL-D", quantity: 2 }] });
    expect(await code(closeBorrowing(w.sup, r.body.id, "Lost on site", ctx()))).toBe("CONFLICT");
  });

  it("Delete selected on the Closed tab: cancelled requests go, closed loans are only hidden", async () => {
    const w = await world();
    const r = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 2 }]);
    const [line] = (await getBorrowing(w.sup, r.body.id)).lines;
    await giveBack(w, r.body.id, [{ lineId: line.id, quantity: 2 }]);
    const open = await release(w, w.sup, [{ itemId: w.gloves.id, quantity: 1 }]);
    const req = await createBorrowDraft(
      w.field,
      { locationId: w.wh.id, borrowerName: "Juan", purpose: "Job", lines: [{ itemId: w.gloves.id, quantity: 1 }] },
      ctx(),
    );
    await cancelBorrowDraft(w.sup, req.id, "Not needed", ctx());
    expect((await listBorrowings(w.sup, { tab: "closed" })).total).toBe(2);

    expect(await code(bulkDeleteBorrowings(w.field, [r.body.id], ctx()))).toBe("FORBIDDEN");
    const out = await bulkDeleteBorrowings(w.sup, [r.body.id, req.id, open.body.id], ctx());
    expect(out.deleted).toEqual(["request for Juan"]);
    expect(out.hidden).toEqual([r.body.reference]);
    expect(out.skipped).toEqual([
      { label: open.body.reference, reason: "Only closed loans and cancelled requests can be deleted." },
    ]);
    expect((await listBorrowings(w.sup, { tab: "closed" })).total).toBe(0);
    // The hidden loan, its stock moves and its forms are all still there.
    expect((await getBorrowing(w.sup, r.body.id)).hiddenAt).not.toBeNull();
    expect(await prisma.stockTransaction.count({ where: { reference: r.body.reference } })).toBe(1);
    expect(await prisma.borrowing.findUnique({ where: { id: req.id } })).toBeNull();
  });

  it("lists loans by tab with unit totals, with overdue ones separate", async () => {
    const w = await world();
    await release(w, w.sup, [{ itemId: w.drill.id, quantity: 2 }], {
      dueAt: new Date(Date.now() - 86400_000).toISOString(),
    });
    await release(w, w.sup, [{ itemId: w.gloves.id, quantity: 5 }]);
    const tab = async (t: "active" | "overdue" | "closed") => (await listBorrowings(w.sup, { tab: t })).rows;
    expect([(await tab("active")).length, (await tab("overdue")).length, (await tab("closed")).length]).toEqual([
      2, 1, 0,
    ]);
    expect((await tab("overdue"))[0]).toMatchObject({ total: 2, returned: 0, items: ["2 × Cordless Drill"] });
    expect(await code(getBorrowing(w.siteSup, (await tab("active"))[0].id))).toBe("NOT_FOUND");
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
    const bor = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 2 }]);
    const { lines } = await getBorrowing(w.sup, bor.body.id);
    const ret = await giveBack(w, bor.body.id, [{ lineId: lines[0].id, quantity: 1 }]);
    const expectations: [string | undefined, string, string[]][] = [
      [
        iss.body.documentId,
        "Stock Issuance",
        [iss.body.reference, "Pedro Santos", "WO-7", "PPE-1", "Safety Gloves", "5", "WH-A"],
      ],
      [trn.body.documentId, "Transmittal", [trn.body.reference, "WH-A", "SITE-B", "PPE-1", "7", "Site stock"]],
      [bor.body.documentId, "Equipment Borrowing", [bor.body.reference, "José Peña", "TOOL-D", "2 pcs"]],
      [
        ret.body.documentId,
        "Return Acknowledgment",
        [ret.body.reference, bor.body.reference, "TOOL-D", "1 pcs", "Good", "1 still out"],
      ],
    ];
    for (const [id, title, words] of expectations) {
      expect(id, title).toBeTruthy();
      const [page] = await pdfText((await documentFile(w.admin, id!)).bytes);
      expect(page).toContain(title);
      for (const s of words) expect(page, `${title}: ${s}`).toContain(s);
    }
  });

  it("A24: a 30-line loan prints on several pages", async () => {
    const w = await world();
    const items = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        prisma.item.create({
          data: { sku: `TOOL-${String(i + 1).padStart(4, "0")}`, name: `Tool ${i + 1}`, unitId: w.pcs.id },
        }),
      ),
    );
    const lines = items.map((i) => ({ itemId: i.id, quantity: 1 }));
    await receiveStock(w.admin, { locationId: w.wh.id, lines }, ctx(), randomUUID());
    const r = await release(w, w.sup, lines);
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
    expect(await onHand(w.gloves.id, w.wh.id)).toBe(45);
    const failed = await prisma.pdfDocument.findUniqueOrThrow({ where: { id: iss.body.documentId } });
    expect([failed.status, failed.attempts, failed.reference]).toEqual(["PDF_FAILED", 1, iss.body.reference]);
    expect(failed.lastError).not.toMatch(/Pedro/);
    expect(await code(documentFile(w.sup, failed.id))).toBe("CONFLICT");

    setRendererForTests(null);
    const doc = await retryDocument(w.sup, failed.id, ctx());
    expect(doc.status).toBe("READY");
    expect(await onHand(w.gloves.id, w.wh.id)).toBe(45);
    expect(await prisma.stockTransaction.count({ where: { type: "ISSUE" } })).toBe(1);
    expect((await documentFile(w.sup, failed.id)).filename).toBe(`${iss.body.reference}_Stock_Issuance.pdf`);
  });

  it("keeps the printed values frozen and the file honest", async () => {
    const w = await world();
    const r = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 1 }]);
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
    const r = await release(w, w.sup, [{ itemId: w.drill.id, quantity: 1 }]);
    expect(await code(documentFile(w.siteSup, r.body.documentId))).toBe("NOT_FOUND");
    expect(await code(documentFile(w.field, r.body.documentId))).toBe("NOT_FOUND");
    expect((await documentFile(w.admin, r.body.documentId)).bytes.length).toBeGreaterThan(1000);
  });

  it("the renderer used by the service is the real one by default", async () => {
    expect(typeof renderPdf).toBe("function");
  });
});
