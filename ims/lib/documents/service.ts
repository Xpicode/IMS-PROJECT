import "server-only";
import { hasCode } from "@/lib/db/search";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { prisma, Prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { sha256 } from "@/lib/crypto";
import { formatDateTime } from "@/lib/format";
import type { Ctx } from "@/lib/context";
import { renderPdf, type DocSnapshot } from "./pdf";

/**
 * Official documents (spec §13.3–13.7).
 * - A document row with an immutable snapshot is created INSIDE the confirm
 *   transaction (same reference as the transaction), so the number and the
 *   printed values can never drift from the record.
 * - The PDF is drawn AFTER commit from that snapshot only. If drawing fails the
 *   transaction stands, the document is PDF_FAILED, and Retry redraws it (A25).
 * - Files live in a private folder and are served only after a permission and
 *   checksum check. Never from public/.
 */
type Tx = Prisma.TransactionClient;
export type DocType = "STOCK_ISSUANCE" | "TRANSMITTAL" | "EQUIPMENT_BORROWING" | "RETURN_ACKNOWLEDGMENT";

export const TEMPLATE_VERSION = "IMS-GEN-1";
export const DOC_TITLE: Record<DocType, string> = {
  STOCK_ISSUANCE: "Stock Issuance Form",
  TRANSMITTAL: "Transmittal Form",
  EQUIPMENT_BORROWING: "Equipment Borrowing Form",
  RETURN_ACKNOWLEDGMENT: "Return Acknowledgment Form",
};
const FILE_PART: Record<DocType, string> = {
  STOCK_ISSUANCE: "Stock_Issuance",
  TRANSMITTAL: "Transmittal",
  EQUIPMENT_BORROWING: "Equipment_Borrowing",
  RETURN_ACKNOWLEDGMENT: "Return_Acknowledgment",
};
const COND: Record<string, string> = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };
const STATUS: Record<string, string> = {
  AVAILABLE: "Available",
  UNDER_MAINTENANCE: "Under maintenance",
  NEEDS_REVIEW: "Needs review",
};

/**
 * Private PDF folder. File calls on it carry `turbopackIgnore`: they are runtime
 * paths, and tracing them would copy the whole project (and stored PDFs) into the build.
 */
export const documentsDir = () =>
  process.env.DOCUMENTS_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "storage", "documents");
export const fileNameOf = (d: { reference: string; type: DocType }) => `${d.reference}_${FILE_PART[d.type]}.pdf`;

function company() {
  return {
    name: process.env.COMPANY_NAME || "Company name (set COMPANY_NAME)",
    address: process.env.COMPANY_ADDRESS || null,
  };
}

const base = (type: DocType, reference: string | null, at: Date) => ({
  templateVersion: TEMPLATE_VERSION,
  title: DOC_TITLE[type],
  reference,
  company: company(),
  issuedAtText: formatDateTime(at),
});

// ---------------------------------------------------------------------------
// Snapshot builders: read the confirmed records (inside the confirm transaction)
// and freeze exactly what gets printed.
// ---------------------------------------------------------------------------

async function stockSnapshot(tx: Tx, txnId: string): Promise<{ snap: DocSnapshot; locationId: string; type: DocType }> {
  const t = await tx.stockTransaction.findUniqueOrThrow({
    where: { id: txnId },
    include: {
      actor: { select: { name: true } },
      movements: {
        orderBy: { createdAt: "asc" },
        include: {
          item: { select: { sku: true, name: true, unit: { select: { code: true } } } },
          location: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
  const loc = (q: number) => t.movements.find((m) => Math.sign(m.quantity) === q)?.location;
  const cols = [
    { key: "no", label: "#", width: 0.07, align: "right" as const },
    { key: "code", label: "Item code", width: 0.2 },
    { key: "desc", label: "Description", width: 0.47 },
    { key: "qty", label: "Quantity", width: 0.13, align: "right" as const },
    { key: "unit", label: "Unit", width: 0.13 },
  ];
  const out = t.movements.filter((m) => m.quantity < 0);
  const rows = out.map((m, i) => ({
    no: String(i + 1),
    code: m.item.sku,
    desc: m.item.name,
    qty: String(-m.quantity),
    unit: m.item.unit.code,
  }));
  if (t.type === "ISSUE") {
    const from = loc(-1)!;
    return {
      type: "STOCK_ISSUANCE",
      locationId: from.id,
      snap: {
        ...base("STOCK_ISSUANCE", t.reference, t.confirmedAt),
        fields: [
          { label: "Issued from", value: `${from.code} · ${from.name}` },
          { label: "Recipient", value: t.recipientName ?? "" },
          { label: "Purpose", value: t.reason ?? "" },
          { label: "Prepared by", value: t.actor.name },
          ...(t.notes ? [{ label: "Notes", value: t.notes }] : []),
        ],
        columns: cols,
        rows,
        remarks: null,
        signatures: [
          { role: "Prepared by", name: t.actor.name },
          { role: "Issued by", name: t.actor.name },
          { role: "Received by", name: t.recipientName },
          { role: "Approved by", name: null },
        ],
      },
    };
  }
  const from = loc(-1)!;
  const to = loc(1)!;
  return {
    type: "TRANSMITTAL",
    locationId: from.id,
    snap: {
      ...base("TRANSMITTAL", t.reference, t.confirmedAt),
      fields: [
        { label: "From (sender)", value: `${from.code} · ${from.name}` },
        { label: "To (receiver)", value: `${to.code} · ${to.name}` },
        { label: "Reason", value: t.reason ?? "—" },
        { label: "Prepared by", value: t.actor.name },
        ...(t.notes ? [{ label: "Notes", value: t.notes }] : []),
      ],
      columns: cols,
      rows,
      remarks:
        "Stock was moved in the system when this transfer was confirmed. The receiver signs to acknowledge the items listed.",
      signatures: [
        { role: "Prepared by", name: t.actor.name },
        { role: "Released by (sender)", name: null },
        { role: "Received by (receiver)", name: null },
        { role: "Approved by", name: null },
      ],
    },
  };
}

const assetCols = (extra: { key: string; label: string; width: number }[]) => [
  { key: "no", label: "#", width: 0.06, align: "right" as const },
  { key: "tag", label: "Asset tag", width: 0.16 },
  { key: "desc", label: "Description", width: 0.34 },
  ...extra,
];

async function borrowingSnapshot(tx: Tx, id: string): Promise<DocSnapshot> {
  const b = await tx.borrowing.findUniqueOrThrow({
    where: { id },
    include: {
      location: true,
      preparedBy: { select: { name: true } },
      releasedBy: { select: { name: true } },
      lines: {
        where: { status: { not: "PENDING" } },
        include: { asset: { include: { item: { select: { name: true } } } } },
        orderBy: { asset: { tag: "asc" } },
      },
    },
  });
  return {
    ...base("EQUIPMENT_BORROWING", b.reference, b.releasedAt!),
    fields: [
      { label: "Borrower", value: b.borrowerName },
      { label: "Department / site", value: b.borrowerDept ?? "—" },
      { label: "Purpose", value: b.purpose },
      { label: "Due back", value: b.dueAt ? formatDateTime(b.dueAt) : "—" },
      { label: "Released from", value: `${b.location.code} · ${b.location.name}` },
      { label: "Released by", value: b.releasedBy?.name ?? "" },
      ...(b.notes ? [{ label: "Notes", value: b.notes }] : []),
    ],
    columns: assetCols([
      { key: "cond", label: "Condition", width: 0.14 },
      { key: "acc", label: "Accessories", width: 0.3 },
    ]),
    rows: b.lines.map((l, i) => ({
      no: String(i + 1),
      tag: l.asset.tag,
      desc: l.asset.item.name + (l.asset.serialNumber ? ` · S/N ${l.asset.serialNumber}` : ""),
      cond: COND[l.conditionOut ?? ""] ?? "",
      acc: l.accessories ?? "—",
    })),
    remarks:
      "The borrower is responsible for the equipment above until it is returned and a Return Acknowledgment is signed.",
    signatures: [
      { role: "Prepared by", name: b.preparedByName ?? b.preparedBy.name },
      { role: "Released by", name: b.releasedBy?.name ?? null },
      { role: "Received by (borrower)", name: b.receivedByName ?? b.borrowerName },
      { role: "Approved by", name: null },
    ],
  };
}

async function returnSnapshot(tx: Tx, id: string): Promise<DocSnapshot> {
  const r = await tx.assetReturn.findUniqueOrThrow({
    where: { id },
    include: {
      location: true,
      receivedBy: { select: { name: true } },
      borrowing: { select: { reference: true, borrowerName: true } },
      lines: {
        include: { asset: { include: { item: { select: { name: true } } } } },
        orderBy: { asset: { tag: "asc" } },
      },
    },
  });
  return {
    ...base("RETURN_ACKNOWLEDGMENT", r.reference, r.returnedAt),
    fields: [
      { label: "Borrowing reference", value: r.borrowing.reference ?? "" },
      { label: "Borrower", value: r.borrowing.borrowerName },
      { label: "Returned by", value: r.returnedByName },
      { label: "Received at", value: `${r.location.code} · ${r.location.name}` },
      { label: "Return date", value: formatDateTime(r.returnedAt) },
      { label: "Received by", value: r.receivedBy.name },
      ...(r.notes ? [{ label: "Notes", value: r.notes }] : []),
    ],
    columns: assetCols([
      { key: "cond", label: "Condition", width: 0.12 },
      { key: "status", label: "Now", width: 0.14 },
      { key: "miss", label: "Missing / notes", width: 0.18 },
    ]),
    rows: r.lines.map((l, i) => ({
      no: String(i + 1),
      tag: l.asset.tag,
      desc: l.asset.item.name + (l.asset.serialNumber ? ` · S/N ${l.asset.serialNumber}` : ""),
      cond: COND[l.conditionIn ?? ""] ?? "",
      status: STATUS[l.statusAfterReturn ?? ""] ?? "",
      miss:
        [l.missingAccessories && `Missing: ${l.missingAccessories}`, l.returnNotes].filter(Boolean).join(" · ") || "—",
    })),
    remarks: null,
    signatures: [
      { role: "Returned by", name: r.returnedByName },
      { role: "Received by", name: r.receivedBy.name },
      { role: "Approved by", name: null },
    ],
  };
}

async function createDocument(
  tx: Tx,
  d: {
    type: DocType;
    reference: string;
    sourceType: string;
    sourceId: string;
    locationId: string;
    createdById: string;
    snap: DocSnapshot;
  },
) {
  const doc = await tx.pdfDocument.create({
    data: {
      type: d.type,
      reference: d.reference,
      sourceType: d.sourceType,
      sourceId: d.sourceId,
      locationId: d.locationId,
      createdById: d.createdById,
      templateVersion: TEMPLATE_VERSION,
      snapshot: d.snap as unknown as Prisma.InputJsonValue,
    },
  });
  return doc.id;
}

/** Inside a confirm transaction: freeze the form for a confirmed issue or transfer. */
export async function documentForStockTransaction(tx: Tx, txnId: string, reference: string, createdById: string) {
  const s = await stockSnapshot(tx, txnId);
  return createDocument(tx, { ...s, reference, sourceType: "stock_transaction", sourceId: txnId, createdById });
}

export async function documentForBorrowing(
  tx: Tx,
  id: string,
  reference: string,
  locationId: string,
  createdById: string,
) {
  const snap = await borrowingSnapshot(tx, id);
  return createDocument(tx, {
    type: "EQUIPMENT_BORROWING",
    reference,
    sourceType: "borrowing",
    sourceId: id,
    locationId,
    createdById,
    snap,
  });
}

export async function documentForReturn(
  tx: Tx,
  id: string,
  reference: string,
  locationId: string,
  createdById: string,
) {
  const snap = await returnSnapshot(tx, id);
  return createDocument(tx, {
    type: "RETURN_ACKNOWLEDGMENT",
    reference,
    sourceType: "asset_return",
    sourceId: id,
    locationId,
    createdById,
    snap,
  });
}

/** Draft preview (§13.3): DRAFT watermark, no official number, nothing saved. */
export function previewPdf(
  snap: Omit<DocSnapshot, "templateVersion" | "company" | "reference" | "issuedAtText"> & { type: DocType },
) {
  const { type, ...rest } = snap;
  return renderPdf({ ...base(type, null, new Date()), ...rest }, { draft: true });
}

// ---------------------------------------------------------------------------
// Drawing, storage, retry, download
// ---------------------------------------------------------------------------

let renderer: (s: DocSnapshot) => Promise<Uint8Array> = (s) => renderPdf(s);
/** Tests only: simulate a renderer failure (A25). Pass null to restore. */
export function setRendererForTests(fn: ((s: DocSnapshot) => Promise<Uint8Array>) | null) {
  renderer = fn ?? ((s) => renderPdf(s));
}

/** Draw the PDF from its snapshot and store it. Never throws: failures are recorded on the document. */
export async function renderDocument(id: string) {
  const doc = await prisma.pdfDocument.findUniqueOrThrow({ where: { id } });
  try {
    const bytes = await renderer(doc.snapshot as unknown as DocSnapshot);
    // Stored with "/" on every OS, so a path saved on Windows still works on Linux.
    const rel = path.posix.join(String(doc.createdAt.getUTCFullYear()), fileNameOf(doc));
    const abs = path.join(/*turbopackIgnore: true*/ documentsDir(), rel);
    await mkdir(/*turbopackIgnore: true*/ path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    await writeFile(/*turbopackIgnore: true*/ tmp, bytes);
    await rename(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ abs);
    const pageCount = (await PDFDocument.load(bytes)).getPageCount();
    return await prisma.pdfDocument.update({
      where: { id },
      data: {
        status: "READY",
        filePath: rel,
        sha256: sha256(Buffer.from(bytes)),
        sizeBytes: bytes.length,
        pageCount,
        attempts: { increment: 1 },
        lastError: null,
        renderedAt: new Date(),
      },
    });
  } catch (e) {
    // Log the failure without personal data or document content (§13.7).
    const kind = e instanceof Error ? e.name : "Error";
    console.error(`[pdf] ${doc.reference} could not be drawn (${kind})`);
    return prisma.pdfDocument.update({
      where: { id },
      data: {
        status: "PDF_FAILED",
        attempts: { increment: 1 },
        lastError: `Drawing the PDF failed (${kind}). Use Retry PDF.`,
      },
    });
  }
}

/** Draw only documents that have never been drawn (used right after a confirm). */
export async function renderIfPending(id: string | undefined | null) {
  if (!id) return;
  const d = await prisma.pdfDocument.findUnique({ where: { id }, select: { status: true } });
  if (d?.status === "PENDING") await renderDocument(id);
}

/** Can this person see the document? Hidden (404) otherwise. Field staff only see documents they created. */
async function visibleDocument(actor: AccessUser, id: string) {
  const doc = await prisma.pdfDocument.findUnique({ where: { id } });
  if (!doc || !can(actor, "documents.download", doc.locationId)) throw errors.notFound("document");
  if (actor.role === "FIELD" && doc.createdById !== actor.id) throw errors.notFound("document");
  return doc;
}

export async function documentStatus(actor: AccessUser, id: string) {
  const d = await visibleDocument(actor, id);
  return {
    id: d.id,
    reference: d.reference,
    type: d.type,
    status: d.status,
    lastError: d.lastError,
    pageCount: d.pageCount,
    canRetry: can(actor, "stock.move", d.locationId) || can(actor, "custody.confirm", d.locationId),
  };
}

export async function documentFile(actor: AccessUser, id: string) {
  const doc = await visibleDocument(actor, id);
  if (doc.status !== "READY" || !doc.filePath) {
    throw new ApiError(
      "CONFLICT",
      doc.status === "VOID"
        ? `${doc.reference} was voided.`
        : `The PDF for ${doc.reference} isn't ready. Use Retry PDF; the transaction itself is saved.`,
    );
  }
  // Only ever read inside the private folder, whatever the stored path says.
  const base = path.resolve(/*turbopackIgnore: true*/ documentsDir());
  const file = path.resolve(/*turbopackIgnore: true*/ base, doc.filePath);
  const inside = file.startsWith(base + path.sep);
  const bytes = inside ? await readFile(/*turbopackIgnore: true*/ file).catch(() => null) : null;
  if (!bytes || sha256(bytes) !== doc.sha256) {
    throw new ApiError(
      "CONFLICT",
      `The stored PDF for ${doc.reference} is missing or damaged. Use Retry PDF to draw it again from the saved record.`,
    );
  }
  return { bytes: new Uint8Array(bytes), filename: fileNameOf(doc), doc };
}

/** Redraw from the unchanged snapshot (§13.7). Never touches stock or assets. */
export async function retryDocument(actor: AccessUser, id: string, ctx: Ctx) {
  const doc = await visibleDocument(actor, id);
  if (!can(actor, "stock.move", doc.locationId) && !can(actor, "custody.confirm", doc.locationId)) {
    throw errors.forbidden("redraw official documents");
  }
  if (doc.status === "VOID") throw new ApiError("CONFLICT", `${doc.reference} was voided.`);
  const r = await renderDocument(id);
  await writeAudit(prisma, {
    actorId: actor.id,
    eventType: "document.redrawn",
    recordType: "pdf_document",
    recordId: id,
    after: { reference: doc.reference, status: r.status },
    requestId: ctx.requestId,
  });
  return r;
}

export type DocumentRow = Awaited<ReturnType<typeof listDocuments>>["rows"][number];

export async function listDocuments(
  actor: AccessUser,
  opts: { q?: string; type?: DocType; status?: "READY" | "PDF_FAILED" | "PENDING"; page?: number },
) {
  const scope = requireAccess(actor, "documents.download");
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.PdfDocumentWhereInput = {
    ...(scope.scope === "global" ? {} : { locationId: { in: scope.locationIds } }),
    ...(actor.role === "FIELD" ? { createdById: actor.id } : {}),
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.q?.trim() ? { reference: hasCode(opts.q.trim()) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.pdfDocument.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 50,
      take: 50,
      select: {
        id: true,
        type: true,
        reference: true,
        status: true,
        pageCount: true,
        createdAt: true,
        lastError: true,
        sourceType: true,
        sourceId: true,
        location: { select: { code: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.pdfDocument.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / 50)) };
}
