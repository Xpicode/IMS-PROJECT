import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Printer } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { NoAccess } from "@/components/common/no-access";
import { PageHeader } from "@/components/common/page-header";
import { StatusChip } from "@/components/common/status-chip";
import { ChangeStatusButton } from "@/components/assets/asset-actions";
import { CONDITION } from "@/lib/assets/labels";
import { pageAccess } from "@/lib/auth/page";
import { getAsset } from "@/lib/assets/service";
import { ApiError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Asset" };

const EVENT = {
  CREATED: "Added",
  STATUS_CHANGED: "Status changed",
  MOVED: "Moved",
  CUSTODY_CHANGED: "Custodian changed",
  CONDITION_CHANGED: "Condition changed",
  DETAILS_CHANGED: "Details edited",
  BORROWED: "Borrowed",
  RETURNED: "Returned",
} as Record<string, string>;
const STATUS_WORD: Record<string, string> = {
  AVAILABLE: "Available",
  BORROWED: "Borrowed",
  UNDER_MAINTENANCE: "Under maintenance",
  NEEDS_REVIEW: "Needs review",
  LOST: "Lost",
  RETIRED: "Retired",
};

export default async function AssetPage({ params }: PageProps<"/assets/[id]">) {
  const { user, allowed } = await pageAccess("records.view");
  if (!allowed || user.role === "FIELD") return <NoAccess what="Assets" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const a = await getAsset(user, id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const loan =
    a.status === "BORROWED"
      ? await prisma.borrowingLine.findFirst({
          where: { assetId: a.id, status: "OUT" },
          select: { borrowing: { select: { id: true, reference: true, borrowerName: true, dueAt: true } } },
        })
      : null;
  const canLend = a.status === "AVAILABLE" && can(user, "custody.confirm", a.location.id);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link href="/assets" className="text-muted-foreground underline-offset-4 hover:underline">
          Assets
        </Link>{" "}
        / {a.tag}
      </nav>
      <PageHeader
        title={a.tag}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/stock/items/${a.item.id}`} className="underline-offset-4 hover:underline">
              {a.item.name}
            </Link>
            <StatusChip kind="asset" status={a.status} />
          </span>
        }
        actions={
          <>
            {canLend && (
              <Button asChild>
                <Link href={`/borrowing/new?asset=${a.id}`}>
                  <ArrowUpRight aria-hidden /> Borrow
                </Link>
              </Button>
            )}
            {loan && (
              <Button asChild variant="outline">
                <Link href={`/borrowing/${loan.borrowing.id}?return=1`}>Return</Link>
              </Button>
            )}
            {a.canManage && (
              <ChangeStatusButton
                assetId={a.id}
                tag={a.tag}
                version={a.version}
                current={a.status}
                next={a.nextStatuses}
              />
            )}
            <Button asChild variant="outline">
              <Link href={`/labels?type=asset&ids=${a.id}`}>
                <Printer aria-hidden /> Print label
              </Link>
            </Button>
          </>
        }
      />
      {loan && (
        <p className="-mt-3 mb-6 rounded-xl border border-warning/40 bg-warning-soft p-3">
          Out on loan{" "}
          <Link
            href={`/borrowing/${loan.borrowing.id}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {loan.borrowing.reference}
          </Link>{" "}
          to <b>{loan.borrowing.borrowerName}</b>
          {loan.borrowing.dueAt ? `, due ${formatDateTime(loan.borrowing.dueAt)}` : ""}.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section aria-labelledby="det-h" className="rounded-xl border bg-card p-4">
          <h2 id="det-h" className="mb-3 text-xl font-semibold">
            Details
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">Item</dt>
            <dd>
              {a.item.sku} · {a.item.name}
            </dd>
            <dt className="text-muted-foreground">Serial</dt>
            <dd>{a.serialNumber ?? "—"}</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd>
              {a.location.code} · {a.location.name}
            </dd>
            <dt className="text-muted-foreground">Custodian</dt>
            <dd>{a.custodianName ?? "—"}</dd>
            <dt className="text-muted-foreground">Condition</dt>
            <dd>{CONDITION[a.condition]}</dd>
            {a.notes && (
              <>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="break-words">{a.notes}</dd>
              </>
            )}
          </dl>
        </section>
        <section aria-labelledby="hist-h" className="min-w-0">
          <h2 id="hist-h" className="mb-3 text-xl font-semibold">
            History
          </h2>
          <ol className="relative flex flex-col gap-4 border-l-2 pl-6" aria-label="History, newest first">
            {a.events.map((e) => (
              <li key={e.id} className="relative">
                <span
                  className="absolute top-1.5 -left-[31px] size-3 rounded-full border-2 border-primary bg-card"
                  aria-hidden
                />
                <p className="font-medium">
                  {EVENT[e.eventType] ?? e.eventType}
                  {e.eventType === "STATUS_CHANGED" &&
                    e.fromStatus &&
                    e.toStatus &&
                    `: ${STATUS_WORD[e.fromStatus]} → ${STATUS_WORD[e.toStatus]}`}
                  {e.eventType === "CREATED" && e.toLocationCode && ` at ${e.toLocationCode}`}
                  {e.toCondition &&
                    e.eventType !== "CREATED" &&
                    e.fromCondition !== e.toCondition &&
                    ` · condition ${CONDITION[e.toCondition]}`}
                  {e.toCustodian && ` · custodian ${e.toCustodian}`}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(e.createdAt)} · by {e.actor?.name ?? "system"}
                </p>
                {e.notes && <p className="mt-1 break-words">{e.notes}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
