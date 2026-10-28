import "server-only";
import { prisma, Prisma } from "@/lib/db/prisma";
import { ApiError, errors } from "@/lib/api/errors";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { withIdempotency } from "@/lib/idempotency";
import { checkTransition, type AssetStatus } from "@/lib/assets/transitions";
import { lockBalances, post } from "@/lib/inventory/stock";
import { nextReference } from "@/lib/inventory/sequences";
import type { Ctx } from "@/lib/context";

/**
 * Count reconciliation (spec §7.7 steps 8–9, §9.3 "Count approvals", §11.6).
 *
 * A count is an observation; only an approved line changes official stock, by
 * posting ONE adjustment transaction (never by overwriting a balance). A line
 * can't be approved when stock moved there after its snapshot (it needs a
 * recount), when counters disagree (pick one), or twice (A21).
 */
type Tx = Prisma.TransactionClient;
type Cond = "GOOD" | "FAIR" | "DAMAGED";

export type LineState = "DONE" | "RECOUNT" | "NOT_COUNTED" | "MOVED" | "DISAGREE" | "READY";

export type ReviewEntry = {
  id: string;
  counterId: string;
  counter: string;
  quantity: number | null;
  found: boolean | null;
  condition: Cond | null;
  notes: string | null;
  createdAt: string;
};

export type ReviewLine = {
  targetId: string;
  kind: "STOCK" | "ASSET";
  version: number;
  /** Stock lines only (asset lines show `tag`). */
  sku: string | null;
  itemSku: string;
  name: string;
  unit: string;
  tag: string | null;
  serialNumber: string | null;
  expected: number | null;
  expectedStatus: string | null;
  currentCondition: Cond | null;
  entries: ReviewEntry[];
  /** Agreed value when every current count says the same thing. */
  counted: number | null;
  found: boolean | null;
  condition: Cond | null;
  /** counted − expected (stock); 0 / −1 for found / not found (assets). */
  variance: number | null;
  /** Count matches the records exactly: safe to bulk-approve. */
  matches: boolean;
  movedDuringCount: number;
  recountRequested: boolean;
  state: LineState;
  review: {
    decision: "APPROVED" | "KEPT_EXPECTED";
    variance: number | null;
    adjustment: string | null;
    reviewer: string;
    decidedAt: string;
    notes: string | null;
  } | null;
};

const CURRENT: ("SUBMITTED" | "ACCEPTED")[] = ["SUBMITTED", "ACCEPTED"];

/** Look up the session as a reviewer: hidden (404) outside the person's locations, 403 without approve rights. */
async function reviewerSession(db: Tx | typeof prisma, actor: AccessUser, sessionId: string, lock = false) {
  const rows = lock
    ? await db.$queryRaw<{ id: string }[]>`SELECT id FROM count_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`
    : [{ id: sessionId }];
  const s = rows.length
    ? await db.countSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          reference: true,
          name: true,
          status: true,
          version: true,
          snapshotAt: true,
          dueAt: true,
          closedAt: true,
          location: { select: { id: true, code: true, name: true } },
        },
      })
    : null;
  if (!s || !can(actor, "records.view", s.location.id)) throw errors.notFound("count session");
  requireAccess(actor, "counts.approve", s.location.id);
  if (s.status === "CANCELLED")
    throw new ApiError("CONFLICT", `${s.reference} was cancelled, so it can't be reviewed.`);
  return s;
}

/** Signed sum of stock movements of one item at one location after `since`. */
async function movedSince(db: Tx | typeof prisma, itemId: string, locationId: string, since: Date) {
  const r = await db.stockMovement.aggregate({
    where: { itemId, locationId, createdAt: { gt: since } },
    _sum: { quantity: true },
  });
  return r._sum.quantity ?? 0;
}

function agreed(entries: ReviewEntry[]) {
  if (!entries.length) return null;
  const key = (e: ReviewEntry) => `${e.quantity}|${e.found}|${e.condition}`;
  return entries.every((e) => key(e) === key(entries[0])) ? entries[0] : null;
}

async function buildLines(db: Tx | typeof prisma, session: { id: string; snapshotAt: Date; location: { id: string } }) {
  const targets = await db.countSessionItem.findMany({
    where: { sessionId: session.id },
    orderBy: [{ kind: "desc" }, { item: { sku: "asc" } }],
    select: {
      id: true,
      kind: true,
      version: true,
      expectedQuantity: true,
      expectedStatus: true,
      snapshotAt: true,
      recountRequested: true,
      item: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } },
      asset: { select: { tag: true, serialNumber: true, condition: true } },
      entries: {
        where: { status: { in: CURRENT } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          counterId: true,
          quantity: true,
          found: true,
          condition: true,
          notes: true,
          createdAt: true,
          counter: { select: { name: true } },
        },
      },
      review: {
        select: {
          decision: true,
          variance: true,
          decidedAt: true,
          notes: true,
          adjustment: { select: { reference: true } },
          reviewer: { select: { name: true } },
        },
      },
    },
  });
  // One query for all "moved during the count" sums.
  const moved = await db.$queryRaw<{ id: string; moved: bigint }[]>`
    SELECT t.id, COALESCE(SUM(m.quantity), 0) AS moved
    FROM count_session_items t
    JOIN count_sessions s ON s.id = t.session_id
    LEFT JOIN stock_movements m ON m.item_id = t.item_id AND m.location_id = s.location_id
      AND m.created_at > COALESCE(t.snapshot_at, s.snapshot_at)
    WHERE t.session_id = ${session.id}::uuid AND t.kind = 'STOCK'
    GROUP BY t.id`;
  const movedBy = new Map(moved.map((m) => [m.id, Number(m.moved)]));

  return targets.map((t): ReviewLine => {
    const entries: ReviewEntry[] = t.entries.map((e) => ({
      id: e.id,
      counterId: e.counterId,
      counter: e.counter.name,
      quantity: e.quantity,
      found: e.found,
      condition: e.condition as Cond | null,
      notes: e.notes,
      createdAt: e.createdAt.toISOString(),
    }));
    const a = agreed(entries);
    const stock = t.kind === "STOCK";
    const movedDuringCount = stock ? (movedBy.get(t.id) ?? 0) : 0;
    const variance = !a ? null : stock ? a.quantity! - (t.expectedQuantity ?? 0) : a.found ? 0 : -1;
    const matches = !!a && (stock ? variance === 0 : a.found === true && a.condition === (t.asset?.condition ?? null));
    const review = t.review
      ? {
          decision: t.review.decision,
          variance: t.review.variance,
          adjustment: t.review.adjustment?.reference ?? null,
          reviewer: t.review.reviewer.name,
          decidedAt: t.review.decidedAt.toISOString(),
          notes: t.review.notes,
        }
      : null;
    const state: LineState = review
      ? "DONE"
      : !entries.length
        ? t.recountRequested
          ? "RECOUNT"
          : "NOT_COUNTED"
        : movedDuringCount !== 0
          ? "MOVED"
          : !a
            ? "DISAGREE"
            : "READY";
    return {
      targetId: t.id,
      kind: t.kind,
      version: t.version,
      sku: stock ? t.item.sku : null,
      itemSku: t.item.sku,
      name: t.item.name,
      unit: t.item.unit.code,
      tag: t.asset?.tag ?? null,
      serialNumber: t.asset?.serialNumber ?? null,
      expected: t.expectedQuantity,
      expectedStatus: t.expectedStatus,
      currentCondition: (t.asset?.condition as Cond | undefined) ?? null,
      entries,
      counted: a && stock ? a.quantity : null,
      found: a ? a.found : null,
      condition: a ? (a.condition as Cond | null) : null,
      variance,
      matches,
      movedDuringCount,
      recountRequested: t.recountRequested,
      state,
      review,
    };
  });
}

/** Everything the review screen needs for one session. */
export async function getReview(actor: AccessUser, sessionId: string) {
  const session = await reviewerSession(prisma, actor, sessionId);
  const lines = await buildLines(prisma, session);
  const assignees = await prisma.countSessionAssignee.findMany({
    where: { sessionId },
    select: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const counters = assignees.map(({ user }) => ({
    id: user.id,
    name: user.name,
    counted: lines.filter((l) => l.entries.some((e) => e.counterId === user.id)).length,
  }));
  const by = (st: LineState) => lines.filter((l) => l.state === st).length;
  const summary = {
    lines: lines.length,
    counted: lines.filter((l) => l.entries.length > 0).length,
    withDifference: lines.filter((l) => l.entries.length > 0 && !l.matches).length,
    readyMatching: lines.filter((l) => l.state === "READY" && l.matches).length,
    done: by("DONE"),
    ready: by("READY"),
    moved: by("MOVED"),
    disagree: by("DISAGREE"),
    notCounted: by("NOT_COUNTED") + by("RECOUNT"),
  };
  return { session, lines, counters, summary };
}

export type ApproveInput = { entryId?: string; notes?: string };

type LockedTarget = {
  id: string;
  kind: "STOCK" | "ASSET";
  item_id: string;
  asset_id: string | null;
  expected_quantity: number | null;
  snapshot_at: Date | null;
};

async function lockTarget(tx: Tx, sessionId: string, targetId: string) {
  const [t] = await tx.$queryRaw<LockedTarget[]>`
    SELECT id, kind::text AS kind, item_id, asset_id, expected_quantity, snapshot_at
    FROM count_session_items WHERE id = ${targetId}::uuid AND session_id = ${sessionId}::uuid FOR UPDATE`;
  if (!t) throw errors.notFound("count line");
  const decided = await tx.countReview.findUnique({ where: { sessionItemId: t.id }, select: { decision: true } });
  if (decided) {
    throw new ApiError(
      "CONFLICT",
      decided.decision === "APPROVED"
        ? "This line was already approved."
        : 'This line was already closed as "keep expected".',
    );
  }
  return t;
}

async function chooseEntry(tx: Tx, targetId: string, entryId?: string) {
  const current = await tx.countEntry.findMany({
    where: { sessionItemId: targetId, status: { in: CURRENT } },
    orderBy: { createdAt: "asc" },
  });
  if (!current.length) {
    throw new ApiError("VALIDATION_FAILED", "Nobody has counted this line yet. Wait for a count or request a recount.");
  }
  if (entryId) {
    const e = current.find((x) => x.id === entryId);
    if (!e) throw new ApiError("CONFLICT", "That count was replaced by a newer one. Reload and pick again.");
    return e;
  }
  const key = (e: (typeof current)[number]) => `${e.quantity}|${e.found}|${e.condition}`;
  if (!current.every((e) => key(e) === key(current[0]))) {
    throw new ApiError("CONFLICT", "The counters disagree on this line. Pick the count to use, or request a recount.");
  }
  return current[current.length - 1];
}

/** Approve one line. Stock: ONE ADJ- transaction for (counted − balance); zero posts nothing. Assets: Lost / new condition. */
export async function approveLine(
  actor: AccessUser,
  sessionId: string,
  targetId: string,
  input: ApproveInput,
  ctx: Ctx,
  key: string,
) {
  const payload = { sessionId, targetId, entryId: input.entryId ?? null, notes: input.notes?.trim() || null };
  return withIdempotency({ userId: actor.id, key, scope: "POST /api/v1/counts/lines/approve", payload }, async (tx) => {
    const session = await reviewerSession(tx, actor, sessionId, true);
    const t = await lockTarget(tx, sessionId, targetId);
    const entry = await chooseEntry(tx, t.id, input.entryId);
    let variance: number | null = null;
    let adjustment: { id: string; reference: string } | null = null;

    if (t.kind === "STOCK") {
      const item = await tx.item.findUniqueOrThrow({
        where: { id: t.item_id },
        select: { sku: true, unit: { select: { code: true } } },
      });
      const balances = await lockBalances(tx, [{ itemId: t.item_id, locationId: session.location.id }]);
      const since = t.snapshot_at ?? session.snapshotAt;
      const moved = await movedSince(tx, t.item_id, session.location.id, since);
      if (moved !== 0) {
        throw new ApiError(
          "CONFLICT",
          `${item.sku} moved during the count (${moved > 0 ? "+" : ""}${moved} ${item.unit.code}). Request a recount before approving.`,
        );
      }
      const balance = balances.get(`${t.item_id}|${session.location.id}`) ?? 0;
      variance = entry.quantity! - balance;
      if (variance !== 0) {
        const txn = await tx.stockTransaction.create({
          data: {
            reference: await nextReference(tx, "ADJ"),
            type: "ADJUSTMENT",
            reason: `Count ${session.reference}: counted ${entry.quantity}, records ${balance}`,
            notes: payload.notes,
            actorId: actor.id,
            requestId: ctx.requestId,
          },
        });
        await post(tx, txn.id, balances, t.item_id, session.location.id, variance);
        adjustment = { id: txn.id, reference: txn.reference };
      }
    } else {
      const asset = await tx.asset.findUniqueOrThrow({ where: { id: t.asset_id! } });
      if (!entry.found) {
        const why = checkTransition(asset.status as AssetStatus, "LOST", "manual");
        if (why) throw new ApiError("CONFLICT", `${asset.tag}: ${why}`);
        await tx.asset.update({ where: { id: asset.id }, data: { status: "LOST", version: { increment: 1 } } });
        await tx.assetEvent.create({
          data: {
            assetId: asset.id,
            eventType: "count.approved",
            fromStatus: asset.status,
            toStatus: "LOST",
            notes: `Not found in count ${session.reference}${entry.notes ? `: ${entry.notes}` : ""}`,
            actorId: actor.id,
            requestId: ctx.requestId,
          },
        });
      } else if (entry.condition && entry.condition !== asset.condition) {
        await tx.asset.update({
          where: { id: asset.id },
          data: { condition: entry.condition, version: { increment: 1 } },
        });
        await tx.assetEvent.create({
          data: {
            assetId: asset.id,
            eventType: "count.approved",
            fromCondition: asset.condition,
            toCondition: entry.condition,
            notes: `Condition from count ${session.reference}${entry.notes ? `: ${entry.notes}` : ""}`,
            actorId: actor.id,
            requestId: ctx.requestId,
          },
        });
      }
    }

    const review = await tx.countReview.create({
      data: {
        sessionItemId: t.id,
        decision: "APPROVED",
        entryId: entry.id,
        expectedQuantity: t.expected_quantity,
        countedQuantity: entry.quantity,
        variance,
        adjustmentTransactionId: adjustment?.id ?? null,
        notes: payload.notes,
        reviewerId: actor.id,
      },
    });
    await tx.countEntry.update({ where: { id: entry.id }, data: { status: "ACCEPTED" } });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "count.approved",
      recordType: "count_session_item",
      recordId: t.id,
      after: {
        count: session.reference,
        kind: t.kind,
        counted: entry.quantity,
        found: entry.found,
        variance,
        adjustment: adjustment?.reference ?? null,
      },
      requestId: ctx.requestId,
    });
    return {
      status: 200,
      body: {
        reviewId: review.id,
        targetId: t.id,
        decision: "APPROVED" as const,
        counted: entry.quantity,
        variance,
        adjustment,
      },
    };
  });
}

/** Close a line without changing anything (e.g. the counter clearly missed something). */
export async function keepExpected(
  actor: AccessUser,
  sessionId: string,
  targetId: string,
  input: { notes?: string },
  ctx: Ctx,
) {
  return prisma.$transaction(async (tx) => {
    const session = await reviewerSession(tx, actor, sessionId, true);
    const t = await lockTarget(tx, sessionId, targetId);
    const r = await tx.countReview.create({
      data: {
        sessionItemId: t.id,
        decision: "KEPT_EXPECTED",
        expectedQuantity: t.expected_quantity,
        notes: input.notes?.trim() || null,
        reviewerId: actor.id,
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "count.kept_expected",
      recordType: "count_session_item",
      recordId: t.id,
      after: { count: session.reference, notes: r.notes },
      requestId: ctx.requestId,
    });
    return r;
  });
}

/** Approve every counted line that matches the records exactly. Lines with a difference need one-by-one approval. */
export async function approveAllMatching(actor: AccessUser, sessionId: string, ctx: Ctx) {
  return prisma.$transaction(
    async (tx) => {
      const session = await reviewerSession(tx, actor, sessionId, true);
      const lines = (await buildLines(tx, session)).filter((l) => l.state === "READY" && l.matches);
      let approved = 0;
      for (const l of lines) {
        const t = await lockTarget(tx, sessionId, l.targetId);
        const entry = await chooseEntry(tx, t.id);
        if (t.kind === "STOCK") {
          const balances = await lockBalances(tx, [{ itemId: t.item_id, locationId: session.location.id }]);
          const moved = await movedSince(tx, t.item_id, session.location.id, t.snapshot_at ?? session.snapshotAt);
          if (moved !== 0 || balances.get(`${t.item_id}|${session.location.id}`) !== entry.quantity) continue;
        }
        await tx.countReview.create({
          data: {
            sessionItemId: t.id,
            decision: "APPROVED",
            entryId: entry.id,
            expectedQuantity: t.expected_quantity,
            countedQuantity: entry.quantity,
            variance: t.kind === "STOCK" ? 0 : null,
            reviewerId: actor.id,
          },
        });
        await tx.countEntry.update({ where: { id: entry.id }, data: { status: "ACCEPTED" } });
        approved++;
      }
      await writeAudit(tx, {
        actorId: actor.id,
        eventType: "count.approved_matching",
        recordType: "count_session",
        recordId: sessionId,
        after: { count: session.reference, approved },
        requestId: ctx.requestId,
      });
      return { approved };
    },
    { timeout: 60_000 },
  );
}

/** Ask for a line to be counted again: new expected snapshot, version + 1, current counts superseded. */
export async function requestRecount(actor: AccessUser, sessionId: string, targetId: string, ctx: Ctx) {
  return prisma.$transaction(async (tx) => {
    const session = await reviewerSession(tx, actor, sessionId, true);
    if (session.status !== "OPEN") {
      throw new ApiError("CONFLICT", `${session.reference} is closed. Reopen it to ask for a recount.`);
    }
    const t = await lockTarget(tx, sessionId, targetId);
    let expected: number | null = t.expected_quantity;
    let expectedStatus: string | null = null;
    if (t.kind === "STOCK") {
      const b = await lockBalances(tx, [{ itemId: t.item_id, locationId: session.location.id }]);
      expected = b.get(`${t.item_id}|${session.location.id}`) ?? 0;
    } else {
      expectedStatus = (await tx.asset.findUniqueOrThrow({ where: { id: t.asset_id! }, select: { status: true } }))
        .status;
    }
    // Snapshot time from the database clock, the same clock that stamps movements.
    await tx.$executeRaw`
      UPDATE count_session_items
      SET version = version + 1, recount_requested = true, snapshot_at = now(),
          expected_quantity = ${expected},
          expected_status = COALESCE(${expectedStatus}::"AssetStatus", expected_status)
      WHERE id = ${t.id}::uuid`;
    // Phones compare the session version to know there is something new to download.
    await tx.countSession.update({ where: { id: sessionId }, data: { version: { increment: 1 } } });
    const superseded = await tx.countEntry.updateMany({
      where: { sessionItemId: t.id, status: { in: CURRENT } },
      data: { status: "SUPERSEDED" },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "count.recount_requested",
      recordType: "count_session_item",
      recordId: t.id,
      after: { count: session.reference, expected, superseded: superseded.count },
      requestId: ctx.requestId,
    });
    return { targetId: t.id };
  });
}

/** CLOSED → OPEN, e.g. to ask for recounts after closing. */
export async function reopenCountSession(actor: AccessUser, sessionId: string, ctx: Ctx) {
  const s = await prisma.countSession.findUnique({
    where: { id: sessionId },
    select: { locationId: true, status: true, reference: true },
  });
  if (!s || !can(actor, "records.view", s.locationId)) throw errors.notFound("count session");
  requireAccess(actor, "counts.create", s.locationId);
  if (s.status !== "CLOSED") throw new ApiError("CONFLICT", `${s.reference} is not closed.`);
  return prisma.$transaction(async (tx) => {
    const r = await tx.countSession.update({
      where: { id: sessionId },
      data: { status: "OPEN", closedAt: null, version: { increment: 1 } },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      eventType: "count.reopened",
      recordType: "count_session",
      recordId: sessionId,
      requestId: ctx.requestId,
    });
    return r;
  });
}
