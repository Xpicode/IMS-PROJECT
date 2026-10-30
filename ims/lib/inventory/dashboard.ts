import "server-only";
import { prisma } from "@/lib/db/prisma";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { listItems, scopeLocations } from "./items";
import { formatDateTime } from "@/lib/format";

/** Dashboard v1 numbers, limited to the user's locations. */
export async function dashboardData(actor: AccessUser) {
  const scope = requireAccess(actor, "records.view");
  const locs = scopeLocations(scope);
  const assetWhere = locs ? { locationId: { in: locs } } : {};
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [all, low, out, assets, moves, lowList] = await Promise.all([
    listItems(actor, { pageSize: 1 }),
    // Low/out only counts items with a low-stock level; never-stocked catalog items aren't alerts.
    listItems(actor, { stock: "low", watched: true, pageSize: 1 }),
    listItems(actor, { stock: "out", watched: true, pageSize: 1 }),
    prisma.asset.groupBy({ by: ["status"], where: assetWhere, _count: true }),
    prisma.stockTransaction.count({
      where: { confirmedAt: { gte: since }, ...(locs ? { movements: { some: { locationId: { in: locs } } } } : {}) },
    }),
    Promise.all([
      listItems(actor, { stock: "out", watched: true, pageSize: 5 }),
      listItems(actor, { stock: "low", watched: true, pageSize: 5 }),
    ]),
  ]);
  const byStatus = Object.fromEntries(assets.map((a) => [a.status, a._count])) as Record<string, number>;
  return {
    items: all.total,
    low: low.total,
    out: out.total,
    assetsTotal: assets.reduce((s, a) => s + (a.status === "RETIRED" ? 0 : a._count), 0),
    borrowed: byStatus.BORROWED ?? 0,
    needsReview: (byStatus.NEEDS_REVIEW ?? 0) + (byStatus.LOST ?? 0),
    assetsByStatus: byStatus,
    movesThisWeek: moves,
    attention: [...lowList[0].rows, ...lowList[1].rows].slice(0, 5),
  };
}

export type ActionItem = {
  kind: "countReview" | "borrowRequests" | "overdueLoans" | "failedPdfs" | "assetsToReview";
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
  const [waiting, requests, overdue, failed, review] = await Promise.all([
    // Counted lines with no decision yet, in open counts.
    prisma.countSessionItem.findMany({
      where: { session: { status: "OPEN", locationId: at }, review: null, entries: { some: { status: "SUBMITTED" } } },
      select: { session: { select: { id: true, name: true } } },
    }),
    prisma.borrowing.count({ where: { status: "DRAFT", locationId: at } }),
    prisma.borrowing.count({ where: { status: "OPEN", dueAt: { lt: new Date() }, locationId: at } }),
    prisma.pdfDocument.count({ where: { status: "PDF_FAILED", locationId: at } }),
    prisma.asset.count({ where: { status: "NEEDS_REVIEW", locationId: at } }),
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
  if (review)
    out.push({
      kind: "assetsToReview",
      count: review,
      text: `${plural(review, "asset")} waiting for review after a return or count`,
      href: "/assets?status=NEEDS_REVIEW",
      button: "Check",
    });
  return out;
}

/** Last 10 confirmed stock transactions and loans/returns in my locations. */
export async function recentActivity(actor: AccessUser) {
  if (actor.role === "FIELD") return [];
  const locs = scopeLocations(requireAccess(actor, "records.view"));
  const at = locs ? { in: locs } : undefined;
  const [txns, loans, returns] = await Promise.all([
    prisma.stockTransaction.findMany({
      where: locs ? { movements: { some: { locationId: at } } } : {},
      orderBy: { confirmedAt: "desc" },
      take: 10,
      select: {
        reference: true,
        type: true,
        confirmedAt: true,
        recipientName: true,
        actor: { select: { name: true } },
        movements: { select: { quantity: true, item: { select: { name: true } } }, take: 3 },
      },
    }),
    prisma.borrowing.findMany({
      where: { status: { in: ["OPEN", "CLOSED"] }, locationId: at },
      orderBy: { releasedAt: "desc" },
      take: 10,
      select: {
        reference: true,
        releasedAt: true,
        borrowerName: true,
        releasedBy: { select: { name: true } },
        lines: { select: { asset: { select: { tag: true } } } },
      },
    }),
    prisma.assetReturn.findMany({
      where: { locationId: at },
      orderBy: { returnedAt: "desc" },
      take: 10,
      select: {
        reference: true,
        returnedAt: true,
        returnedByName: true,
        receivedBy: { select: { name: true } },
        lines: { select: { asset: { select: { tag: true } } } },
      },
    }),
  ]);
  const VERB: Record<string, string> = {
    RECEIPT: "Received",
    ISSUE: "Issued",
    TRANSFER: "Moved",
    ADJUSTMENT: "Count adjustment",
  };
  const tags = (ls: { asset: { tag: string } }[]) =>
    ls
      .map((l) => l.asset.tag)
      .slice(0, 3)
      .join(", ") + (ls.length > 3 ? ` +${ls.length - 3}` : "");
  const rows = [
    ...txns.map((t) => {
      const parts = t.movements.filter((m) => (t.type === "TRANSFER" ? m.quantity > 0 : true));
      return {
        at: t.confirmedAt,
        reference: t.reference,
        what: `${VERB[t.type]} ${parts.map((m) => `${Math.abs(m.quantity)} ${m.item.name}`).join(", ")}${t.recipientName ? ` to ${t.recipientName}` : ""}`,
        who: t.actor.name,
      };
    }),
    ...loans.map((b) => ({
      at: b.releasedAt!,
      reference: b.reference!,
      what: `${tags(b.lines)} borrowed by ${b.borrowerName}`,
      who: b.releasedBy?.name ?? "",
    })),
    ...returns.map((r) => ({
      at: r.returnedAt,
      reference: r.reference,
      what: `${tags(r.lines)} returned by ${r.returnedByName}`,
      who: r.receivedBy.name,
    })),
  ];
  return rows
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10)
    .map((r) => ({ ...r, when: formatDateTime(r.at), at: r.at.toISOString() }));
}
