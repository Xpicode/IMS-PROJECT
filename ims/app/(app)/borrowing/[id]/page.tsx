import Link from "next/link";
import { notFound } from "next/navigation";
import { NoAccess } from "@/components/common/no-access";
import { PageHeader } from "@/components/common/page-header";
import { StatusChip } from "@/components/common/status-chip";
import { LoanDetail } from "@/components/borrowing/loan-detail";
import { pageAccess } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { getBorrowing } from "@/lib/borrowing/service";
import { locationsFor } from "@/lib/inventory/page-data";
import { ApiError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Loan" };

export default async function LoanPage({ params, searchParams }: PageProps<"/borrowing/[id]">) {
  const { user, allowed } = await pageAccess("custody.confirm");
  if (!allowed) return <NoAccess what="Borrowing" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await getBorrowing(user, id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const locations = await locationsFor(user, "custody.confirm");
  const returned = b.lines.filter((l) => l.status === "RETURNED").length;
  const title = b.reference ?? "Borrowing request";
  const info: [string, string][] = [
    ["Borrower", b.borrowerName + (b.borrowerDept ? ` · ${b.borrowerDept}` : "")],
    ["Purpose", b.purpose],
    ["From", `${b.location.code} · ${b.location.name}`],
    ["Due back", b.dueAt ? formatDateTime(b.dueAt) : "No due date"],
    ...(b.releasedAt
      ? ([["Released", `${formatDateTime(b.releasedAt)} by ${b.releasedBy?.name ?? ""}`]] as [string, string][])
      : []),
    ...(b.receivedByName && b.receivedByName !== b.borrowerName
      ? ([["Received by", b.receivedByName]] as [string, string][])
      : []),
    ["Prepared by", `${b.preparedByName ?? b.preparedBy.name}, ${formatDateTime(b.createdAt)}`],
    ...(b.closedAt ? ([["Closed", formatDateTime(b.closedAt)]] as [string, string][]) : []),
    ...(b.notes ? ([["Notes", b.notes]] as [string, string][]) : []),
  ];
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link
          href="/borrowing"
          className="inline-block py-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Borrowing
        </Link>{" "}
        / {title}
      </nav>
      <PageHeader
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip kind="loan" status={b.overdue ? "OVERDUE" : b.status} />
            {b.status !== "DRAFT" && (
              <span>
                {returned} of {b.lines.length} returned
              </span>
            )}
          </span>
        }
      />
      <dl className="mb-6 grid gap-x-6 gap-y-2 rounded-xl border bg-card p-4 sm:grid-cols-[auto_1fr]">
        {info.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <LoanDetail
        loanId={b.id}
        startReturning={(await searchParams).return === "1"}
        status={b.status}
        borrowerName={b.borrowerName}
        canAct={can(user, "custody.confirm", b.locationId)}
        locationId={b.locationId}
        locations={locations}
        documents={b.documents.map((d) => ({ id: d.id, reference: d.reference, type: d.type }))}
        lines={b.lines.map((l) => ({
          id: l.id,
          status: l.status,
          tag: l.asset.tag,
          assetId: l.asset.id,
          name: l.asset.item.name,
          serialNumber: l.asset.serialNumber,
          conditionOut: l.conditionOut,
          accessories: l.accessories,
          conditionIn: l.conditionIn,
          statusAfterReturn: l.statusAfterReturn,
          missingAccessories: l.missingAccessories,
          returnReference: l.return?.reference ?? null,
        }))}
      />
    </>
  );
}
