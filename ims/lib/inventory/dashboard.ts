import "server-only";
import { prisma } from "@/lib/db/prisma";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { listItems, scopeLocations } from "./items";
import { formatDateTime } from "@/lib/format";

/** Dashboard v1 numbers, limited to the user's locations. */
export async function dashboardData(actor: AccessUser) {
  const scope = requireAccess(actor, "records.view");
  const locs = scopeLocations(scope);
  const at = locs ? { in: locs } : undefined;
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [all, low, out, openLoans, overdueLoans, moves, lowList] = await Promise.all([
    listItems(actor, { pageSize: 1 }),
    // Low/out only counts items with a low-stock level; never-stocked catalog items aren't alerts.
    listItems(actor, { stock: "low", watched: true, pageSize: 1 }),
    listItems(actor, { stock: "out", watched: true, pageSize: 1 }),
    prisma.borrowing.count({ where: { status: "OPEN", locationId: at } }),
    prisma.borrowing.count({ where: { status: "OPEN", dueAt: { lt: new Date() }, locationId: at } }),
    prisma.stockTransaction.count({
      where: { confirmedAt: { gte: since }, ...(locs ? { movements: { some: { locationId: { in: locs } } } } : {}) },
    }),
    Promise.all([
      listItems(actor, { stock: "out", watched: true, pageSize: 5 }),
      listItems(actor, { stock: "low", watched: true, pageSize: 5 }),
    ]),
  ]);
  return {
    items: all.total,
    low: low.total,
    out: out.total,
    openLoans,
    overdueLoans,
    movesThisWeek: moves,
    attention: [...lowList[0].rows, ...lowList[1].rows].slice(0, 5),
  };
}

export type ActionItem = {
  kind: "countReview" | "borrowRequests" | "overdueLoans" | "failedPdfs";
  count: number;
  text: string;
  href: string;
  button: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Needs your action" (BUILD_PLAN §4.3): real work waiting in my locations, one
 * button each, so a supervisor can clear the day without opening the menu.
 * Field staff get nothing here (they use the field app).
 */
export async function needsAction(actor: AccessUser): Promise<ActionItem[]> {
  if (actor.role === "FIELD") return [];
  const locs = scopeLocations(requireAccess(actor, "records.view"));
  const at = locs ? { in: locs } : undefined;
  const [waiting, requests, overdue, failed] = await Promise.all([
    // Counted lines with no decision yet, in open counts.
    prisma.countSessionItem.findMany({
      where: { session: { status: "OPEN", locationId: at }, review: null, entries: { some: { status: "SUBMITTED" } } },
      select: { session: { select: { id: true, name: true } } },
    }),
    prisma.borrowing.count({ where: { status: "DRAFT", locationId: at } }),
    prisma.borrowing.count({ where: { status: "OPEN", dueAt: { lt: new Date() }, locationId: at } }),
    prisma.pdfDocument.count({ where: { status: "PDF_FAILED", locationId: at } }),
  ]);
  const out: ActionItem[] = [];
  if (waiting.length) {
    const sessions = [...new Map(waiting.map((w) => [w.session.id, w.session])).values()];
    out.push({
      kind: "countReview",
      count: waiting.length,
      text:
        sessions.length === 1
          ? `${plural(waiting.length, "count line")} waiting for review in ${sessions[0].name}`
          : `${plural(waiting.length, "count line")} waiting for review in ${sessions.length} counts`,
      href: sessions.length === 1 ? `/counts/${sessions[0].id}` : "/counts",
      button: "Review",
    });
  }
  if (requests)
    out.push({
      kind: "borrowRequests",
      count: requests,
      text: `${plural(requests, "borrow request")} to release`,
      href: "/borrowing?tab=requests",
      button: "Open",
    });
  if (overdue)
    out.push({
      kind: "overdueLoans",
      count: overdue,
      text: `${plural(overdue, "loan")} overdue`,
      href: "/borrowing?tab=overdue",
      button: "Follow up",
    });
  if (failed)
    out.push({
      kind: "failedPdfs",
      count: failed,
      text: `${plural(failed, "PDF")} failed to generate`,
      href: "/documents?status=PDF_FAILED",
      button: "Retry",
    });
  return out;
}

/**
 * Confirmed stock moves in my locations (loans and returns included), newest first, one page at a time.
 */
export async function recentActivity(actor: AccessUser, opts: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const size = Math.min(1000, Math.max(1, opts.pageSize ?? 10));
  if (actor.role === "FIELD") return { rows: [], total: 0, page: 1, pageCount: 1 };
  const locs = scopeLocations(requireAccess(actor, "records.view"));
  const at = locs ? { in: locs } : undefined;
  const where = locs ? { movements: { some: { locationId: at } } } : {};
  const [txns, total] = await Promise.all([
    prisma.stockTransaction.findMany({
      where,
      orderBy: { confirmedAt: "desc" },
      skip: (page - 1) * size,
      take: size,
      select: {
        reference: true,
        type: true,
        confirmedAt: true,
        recipientName: true,
        source: true,
        actor: { select: { name: true } },
        movements: { select: { quantity: true, item: { select: { name: true } } }, take: 3 },
      },
    }),
    prisma.stockTransaction.count({ where }),
  ]);
  const VERB: Record<string, string> = {
    RECEIPT: "Received",
    ISSUE: "Issued",
    TRANSFER: "Moved",
    ADJUSTMENT: "Count adjustment",
    BORROW: "Lent",
    RETURN: "Returned",
  };
  const rows = txns.map((t) => {
    const parts = t.movements.filter((m) => (t.type === "TRANSFER" ? m.quantity > 0 : true));
    const whom = t.recipientName ? ` to ${t.recipientName}` : t.type === "RETURN" && t.source ? ` (${t.source})` : "";
    return {
      at: t.confirmedAt,
      reference: t.reference,
      what: `${VERB[t.type]} ${parts.map((m) => `${Math.abs(m.quantity)} ${m.item.name}`).join(", ")}${whom}`,
      who: t.actor.name,
    };
  });
  return {
    rows: rows.map((r) => ({ ...r, when: formatDateTime(r.at), at: r.at.toISOString() })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / size)),
  };
}
