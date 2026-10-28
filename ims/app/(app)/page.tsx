import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ClipboardList, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { pageAccess } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { StatusChip } from "@/components/common/status-chip";
import { dashboardData } from "@/lib/inventory/dashboard";
import { cn } from "@/lib/utils";

function Kpi({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  tone?: "warning" | "danger";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-card p-4 hover:bg-muted/50",
        tone === "warning" && value > 0 && "border-warning/40 bg-warning-soft",
        tone === "danger" && value > 0 && "border-danger/40 bg-danger-soft",
      )}
    >
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
    </Link>
  );
}

export const metadata = { title: "Home" };

export default async function HomePage() {
  const { user } = await pageAccess();
  const first = user.name.split(" ")[0];

  if (user.role === "FIELD") {
    return (
      <>
        <PageHeader title="My assignments" description={`Hello, ${first}.`} />
        <EmptyState
          icon={ClipboardList}
          title="No assignments yet"
          description="When a supervisor assigns you a count, it appears here. Download it while you have internet so you can count offline."
        />
      </>
    );
  }

  const d = await dashboardData(user);
  const canMove = can(user, "stock.move");
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Hello, ${first}.`}
        actions={
          canMove ? (
            <>
              <Button asChild>
                <Link href="/stock/receive">
                  <ArrowDownToLine aria-hidden /> Receive
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/stock/issue">
                  <ArrowUpFromLine aria-hidden /> Issue
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/stock/transfer">
                  <ArrowLeftRight aria-hidden /> Transfer
                </Link>
              </Button>
            </>
          ) : undefined
        }
      />
      <section aria-label="Key numbers" className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Items" value={d.items} href="/stock" />
        <Kpi label="Low stock" value={d.low} href="/stock?stock=low" tone="warning" />
        <Kpi label="Out of stock" value={d.out} href="/stock?stock=out" tone="danger" />
        <Kpi label="Assets" value={d.assetsTotal} href="/assets" />
        <Kpi label="Borrowed" value={d.borrowed} href="/assets?status=BORROWED" />
        <Kpi label="Moves (7 days)" value={d.movesThisWeek} href="/stock" />
      </section>
      <section aria-labelledby="low-h" className="mb-8 flex flex-col gap-3">
        <h2 id="low-h" className="text-xl font-semibold">
          Low and out of stock
        </h2>
        {d.attention.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-muted-foreground">
            Everything is above its low-stock level.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {d.attention.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/stock/items/${r.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-muted/50"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{r.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {r.sku} · low at {r.minStock}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular-nums">
                      {r.onHand} {r.unitCode}
                    </span>
                    {r.stockStatus && <StatusChip kind="stock" status={r.stockStatus} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="needs-action" className="flex flex-col gap-3">
        <h2 id="needs-action" className="text-xl font-semibold">
          Needs your action
        </h2>
        <EmptyState
          icon={ListChecks}
          title="Nothing needs you right now"
          description="Count reviews, drafts to release, and failed PDFs will be listed here once those features are built."
          action={
            can(user, "locations.manage") ? (
              <Button asChild variant="outline">
                <Link href="/locations">Set up locations</Link>
              </Button>
            ) : undefined
          }
        />
      </section>
    </>
  );
}
