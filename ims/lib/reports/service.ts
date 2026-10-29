import "server-only";
import { has, hasCode } from "@/lib/db/search";
import { z } from "zod";
import { prisma, Prisma } from "@/lib/db/prisma";
import { errors } from "@/lib/api/errors";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { scopeLocations } from "@/lib/inventory/items";
import { formatDate, formatDateTime } from "@/lib/format";
import type { CsvValue } from "./csv";

/**
 * The five fixed reports (BUILD_PLAN Phase 6, spec §9.5). Each returns
 * display-ready rows (dates already in company time) so the screen and the CSV
 * show exactly the same thing. Always limited to the user's locations.
 */
export const REPORTS = {
  "stock-balances": {
    title: "Stock balances",
    description: "What is on hand at each location, with low and out-of-stock flags.",
  },
  movements: {
    title: "Movement ledger",
    description: "Every stock movement: receipts, issues, transfers, and count adjustments.",
  },
  assets: { title: "Asset status & custody", description: "Where each asset is, its status, and who has it." },
  overdue: { title: "Overdue loans", description: "Borrowed equipment past its due date." },
  "count-discrepancies": {
    title: "Count discrepancies",
    description: "Count lines that differed from the system, and what was decided.",
  },
} as const;
export type ReportName = keyof typeof REPORTS;
export const isReportName = (s: string): s is ReportName => Object.hasOwn(REPORTS, s);

export type Column = { key: string; label: string; align?: "right" };
export type ReportRow = Record<string, CsvValue>;
export type ReportResult = { columns: Column[]; rows: ReportRow[]; total: number; truncated: boolean };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  locationId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  userId: z.uuid().optional(),
  type: z.enum(["RECEIPT", "ISSUE", "TRANSFER", "ADJUSTMENT"]).optional(),
  reference: z.string().trim().max(40).optional(),
  status: z.enum(["AVAILABLE", "BORROWED", "UNDER_MAINTENANCE", "NEEDS_REVIEW", "LOST", "RETIRED"]).optional(),
  stock: z.enum(["low", "out"]).optional(),
  from: day.optional(),
  to: day.optional(),
});
export type ReportFilters = z.input<typeof filterSchema>;

/** Read filters from a query string, dropping blanks. Invalid values are ignored, not errors. */
export function filtersFrom(sp: URLSearchParams | Record<string, string | string[] | undefined>): ReportFilters {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  const out: Record<string, string> = {};
  for (const k of Object.keys(filterSchema.shape)) {
    const v = get(k);
    if (v === undefined) continue;
    const ok = (filterSchema.shape as Record<string, z.ZodType>)[k].safeParse(v);
    if (ok.success) out[k] = v;
  }
  return out;
}

const TYPE: Record<string, string> = {
  RECEIPT: "Receipt",
  ISSUE: "Issue",
  TRANSFER: "Transfer",
  ADJUSTMENT: "Count adjustment",
};
const ASSET: Record<string, string> = {
  AVAILABLE: "Available",
  BORROWED: "Borrowed",
  UNDER_MAINTENANCE: "Under maintenance",
  NEEDS_REVIEW: "Needs review",
  LOST: "Lost",
  RETIRED: "Retired",
};
const COND: Record<string, string> = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };
const TZ = "+08:00";

export async function runReport(
  actor: AccessUser,
  name: ReportName,
  input: ReportFilters,
  opts: { limit?: number } = {},
): Promise<ReportResult> {
  if (!isReportName(name)) throw errors.notFound("report");
  if (actor.role === "FIELD") throw errors.forbidden("view reports");
  const f = filterSchema.parse(input);
  const scope = requireAccess(actor, "reports.view", f.locationId);
  const mine = scopeLocations(scope);
  const locs = f.locationId ? [f.locationId] : mine;
  const limit = Math.min(opts.limit ?? 500, 50_000);
  return BUILDERS[name](f as z.output<typeof filterSchema>, locs, limit);
}

type F = z.output<typeof filterSchema>;
type Builder = (f: F, locs: string[] | null, limit: number) => Promise<ReportResult>;
const inLocs = (locs: string[] | null) => (locs ? { in: locs } : undefined);
const range = (f: F) =>
  f.from || f.to
    ? {
        ...(f.from ? { gte: new Date(`${f.from}T00:00:00${TZ}`) } : {}),
        ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999${TZ}`) } : {}),
      }
    : undefined;
const done = (columns: Column[], rows: ReportRow[], total: number, limit: number): ReportResult => ({
  columns,
  rows: rows.slice(0, limit),
  total,
  truncated: total > limit,
});

const BUILDERS: Record<ReportName, Builder> = {
  async "stock-balances"(f, locs, limit) {
    const where: Prisma.StockBalanceWhereInput = {
      locationId: inLocs(locs),
      item: {
        trackingType: "STOCK",
        ...(f.itemId ? { id: f.itemId } : {}),
        ...(f.q ? { OR: [{ sku: has(f.q) }, { name: has(f.q) }] } : {}),
      },
      ...(f.stock === "out" ? { quantity: 0 } : {}),
    };
    const all = await prisma.stockBalance.findMany({
      where,
      include: {
        item: {
          select: {
            sku: true,
            name: true,
            minStock: true,
            unit: { select: { code: true } },
            category: { select: { name: true } },
          },
        },
        location: { select: { code: true } },
      },
      orderBy: [{ item: { sku: "asc" } }, { location: { code: "asc" } }],
      take: 100_000,
    });
    const status = (q: number, min: number) => (q <= 0 ? "Out" : min > 0 && q <= min ? "Low" : "OK");
    const rows = all
      .map((b) => ({
        sku: b.item.sku,
        name: b.item.name,
        category: b.item.category?.name ?? "",
        location: b.location.code,
        onHand: b.quantity,
        unit: b.item.unit.code,
        minStock: b.item.minStock,
        status: status(b.quantity, b.item.minStock),
      }))
      .filter((r) => (f.stock === "low" ? r.status === "Low" : true));
    return done(
      [
        { key: "sku", label: "SKU" },
        { key: "name", label: "Item" },
        { key: "category", label: "Category" },
        { key: "location", label: "Location" },
        { key: "onHand", label: "On hand", align: "right" },
        { key: "unit", label: "Unit" },
        { key: "minStock", label: "Low at", align: "right" },
        { key: "status", label: "Status" },
      ],
      rows,
      rows.length,
      limit,
    );
  },

  async movements(f, locs, limit) {
    const where: Prisma.StockMovementWhereInput = {
      locationId: inLocs(locs),
      ...(f.itemId ? { itemId: f.itemId } : {}),
      transaction: {
        ...(f.type ? { type: f.type } : {}),
        ...(f.userId ? { actorId: f.userId } : {}),
        ...(f.reference ? { reference: hasCode(f.reference) } : {}),
        ...(range(f) ? { confirmedAt: range(f) } : {}),
      },
      ...(f.q
        ? {
            item: {
              OR: [{ sku: has(f.q) }, { name: has(f.q) }],
            },
          }
        : {}),
    };
    const [total, ms] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        include: {
          item: { select: { sku: true, name: true, unit: { select: { code: true } } } },
          location: { select: { code: true } },
          transaction: {
            select: {
              reference: true,
              type: true,
              confirmedAt: true,
              recipientName: true,
              reason: true,
              source: true,
              externalRef: true,
              actor: { select: { name: true } },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: limit,
      }),
    ]);
    const party = (t: (typeof ms)[number]["transaction"]) =>
      t.type === "ISSUE"
        ? [t.recipientName, t.reason].filter(Boolean).join(" · ")
        : t.type === "RECEIPT"
          ? [t.source, t.externalRef].filter(Boolean).join(" · ")
          : (t.reason ?? "");
    return done(
      [
        { key: "date", label: "Date" },
        { key: "reference", label: "Reference" },
        { key: "type", label: "Type" },
        { key: "sku", label: "SKU" },
        { key: "name", label: "Item" },
        { key: "location", label: "Location" },
        { key: "quantity", label: "Change", align: "right" },
        { key: "balanceAfter", label: "Balance after", align: "right" },
        { key: "unit", label: "Unit" },
        { key: "user", label: "By" },
        { key: "party", label: "To / from / reason" },
      ],
      ms.map((m) => ({
        date: formatDateTime(m.transaction.confirmedAt),
        reference: m.transaction.reference,
        type: TYPE[m.transaction.type],
        sku: m.item.sku,
        name: m.item.name,
        location: m.location.code,
        quantity: m.quantity,
        balanceAfter: m.balanceAfter,
        unit: m.item.unit.code,
        user: m.transaction.actor.name,
        party: party(m.transaction),
      })),
      total,
      limit,
    );
  },

  async assets(f, locs, limit) {
    const where: Prisma.AssetWhereInput = {
      locationId: inLocs(locs),
      ...(f.status ? { status: f.status } : {}),
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.q
        ? {
            OR: [
              { tag: has(f.q) },
              { serialNumber: has(f.q) },
              { custodianName: has(f.q) },
              { item: { name: has(f.q) } },
            ],
          }
        : {}),
    };
    const [total, as] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        include: {
          item: { select: { sku: true, name: true } },
          location: { select: { code: true } },
          borrowingLines: {
            where: { status: "OUT" },
            select: { borrowing: { select: { reference: true, dueAt: true } } },
            take: 1,
          },
        },
        orderBy: { tag: "asc" },
        take: limit,
      }),
    ]);
    return done(
      [
        { key: "tag", label: "Tag" },
        { key: "name", label: "Item" },
        { key: "serial", label: "Serial no." },
        { key: "status", label: "Status" },
        { key: "condition", label: "Condition" },
        { key: "location", label: "Location" },
        { key: "custodian", label: "With" },
        { key: "loan", label: "Loan" },
        { key: "due", label: "Due back" },
      ],
      as.map((a) => {
        const loan = a.borrowingLines[0]?.borrowing;
        return {
          tag: a.tag,
          name: a.item.name,
          serial: a.serialNumber ?? "",
          status: ASSET[a.status],
          condition: COND[a.condition] ?? "",
          location: a.location.code,
          custodian: a.custodianName ?? undefined,
          loan: loan?.reference ?? undefined,
          due: loan?.dueAt ? formatDate(loan.dueAt) : undefined,
        };
      }),
      total,
      limit,
    );
  },

  async overdue(f, locs, limit) {
    const now = new Date();
    const where: Prisma.BorrowingWhereInput = {
      status: "OPEN",
      dueAt: { lt: now },
      locationId: inLocs(locs),
      ...(f.q
        ? {
            OR: [{ borrowerName: has(f.q) }, { reference: hasCode(f.q) }],
          }
        : {}),
    };
    const [total, bs] = await Promise.all([
      prisma.borrowing.count({ where }),
      prisma.borrowing.findMany({
        where,
        include: {
          location: { select: { code: true } },
          lines: { where: { status: "OUT" }, select: { asset: { select: { tag: true } } } },
        },
        orderBy: { dueAt: "asc" },
        take: limit,
      }),
    ]);
    return done(
      [
        { key: "reference", label: "Loan" },
        { key: "borrower", label: "Borrower" },
        { key: "dept", label: "Department / site" },
        { key: "assets", label: "Still out" },
        { key: "due", label: "Due" },
        { key: "daysOverdue", label: "Days overdue", align: "right" },
        { key: "location", label: "From" },
        { key: "purpose", label: "Purpose" },
      ],
      bs.map((b) => ({
        reference: b.reference ?? "",
        borrower: b.borrowerName,
        dept: b.borrowerDept ?? "",
        assets: b.lines.map((l) => l.asset.tag).join(", "),
        due: formatDate(b.dueAt),
        daysOverdue: Math.floor((now.getTime() - b.dueAt!.getTime()) / 86_400_000),
        location: b.location.code,
        purpose: b.purpose,
      })),
      total,
      limit,
    );
  },

  async "count-discrepancies"(f, locs, limit) {
    const where: Prisma.CountReviewWhereInput = {
      target: {
        session: {
          locationId: inLocs(locs),
          ...(f.reference ? { reference: hasCode(f.reference) } : {}),
        },
        ...(f.itemId ? { itemId: f.itemId } : {}),
      },
      OR: [{ variance: { not: 0 } }, { target: { kind: "ASSET" }, entry: { found: false } }],
      ...(range(f) ? { decidedAt: range(f) } : {}),
    };
    const [total, rs] = await Promise.all([
      prisma.countReview.count({ where }),
      prisma.countReview.findMany({
        where,
        include: {
          target: {
            select: {
              kind: true,
              item: { select: { sku: true, name: true } },
              asset: { select: { tag: true } },
              session: { select: { reference: true, name: true, location: { select: { code: true } } } },
            },
          },
          entry: { select: { found: true } },
          adjustment: { select: { reference: true } },
          reviewer: { select: { name: true } },
        },
        orderBy: { decidedAt: "desc" },
        take: limit,
      }),
    ]);
    return done(
      [
        { key: "date", label: "Decided" },
        { key: "count", label: "Count" },
        { key: "location", label: "Location" },
        { key: "sku", label: "SKU / tag" },
        { key: "name", label: "Item" },
        { key: "expected", label: "Expected", align: "right" },
        { key: "counted", label: "Counted", align: "right" },
        { key: "difference", label: "Difference", align: "right" },
        { key: "decision", label: "Decision" },
        { key: "adjustment", label: "Adjustment" },
        { key: "reviewer", label: "Reviewer" },
      ],
      rs.map((r) => ({
        date: formatDateTime(r.decidedAt),
        count: r.target.session.reference,
        location: r.target.session.location.code,
        sku: r.target.kind === "ASSET" ? (r.target.asset?.tag ?? "") : r.target.item.sku,
        name: r.target.item.name,
        expected: r.target.kind === "ASSET" ? "Present" : (r.expectedQuantity ?? undefined),
        counted:
          r.target.kind === "ASSET"
            ? r.entry?.found === false
              ? "Not found"
              : "Found"
            : (r.countedQuantity ?? undefined),
        difference: r.variance ?? undefined,
        decision: r.decision === "APPROVED" ? "Approved" : "Kept expected",
        adjustment: r.adjustment?.reference ?? "",
        reviewer: r.reviewer.name,
      })),
      total,
      limit,
    );
  },
};
