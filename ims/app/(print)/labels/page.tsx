import Link from "next/link";
import { NoAccess } from "@/components/common/no-access";
import { PrintButton } from "@/components/common/print-button";
import { pageAccess } from "@/lib/auth/page";
import { buildLabels } from "@/lib/labels";
import { one } from "@/lib/inventory/page-data";
import type { LabelType } from "@/lib/codes";
import "./labels.css";

export const metadata = { title: "Print labels" };

/**
 * A4 sheet of 70 × 37 mm labels, 3 across × 8 down (24 per sheet; fits the
 * common "24 per sheet" label paper). Print from the browser at 100% scale.
 */
export default async function LabelsPage({ searchParams }: PageProps<"/labels">) {
  const { user, allowed } = await pageAccess("records.view");
  if (!allowed) return <NoAccess what="Labels" />;
  const sp = await searchParams;
  const type = (["item", "asset", "location"].includes(one(sp.type) ?? "") ? one(sp.type) : "item") as LabelType;
  const ids = (one(sp.ids) ?? "").split(",");
  const copies = Math.min(24, Math.max(1, Number(one(sp.copies)) || 1));
  const labels = (await buildLabels(user, type, ids)).flatMap((l) => Array.from({ length: copies }, () => l));
  const back = type === "asset" ? "/assets" : type === "location" ? "/locations" : "/stock";

  return (
    <div className="labels-screen">
      <header className="no-print mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h1 className="text-2xl font-semibold">Print labels</h1>
          <p className="text-muted-foreground">
            {labels.length} {labels.length === 1 ? "label" : "labels"} · A4, 70 × 37 mm, 24 per sheet. In the print
            dialog choose 100% scale (not &quot;Fit to page&quot;).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={back} className="flex h-12 items-center rounded-lg border px-4 font-medium">
            Back
          </Link>
          <form className="flex items-center gap-2">
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="ids" value={ids.join(",")} />
            <label htmlFor="copies" className="text-sm font-medium">
              Copies each
            </label>
            <input
              id="copies"
              name="copies"
              type="number"
              min={1}
              max={24}
              defaultValue={copies}
              className="h-12 w-20 rounded-lg border border-input px-2"
            />
            <button type="submit" className="h-12 rounded-lg border px-3 font-medium">
              Update
            </button>
          </form>
          <PrintButton disabled={labels.length === 0} />
        </div>
      </header>
      {labels.length === 0 ? (
        <p className="no-print mx-auto max-w-[210mm] p-4">Nothing to print. Open this page from an item or asset.</p>
      ) : (
        <div className="sheet-wrap">
          <div className="label-sheet">
            {labels.map((l, i) => (
              <div key={i} className="label">
                <div className="label-qr" dangerouslySetInnerHTML={{ __html: l.qr }} />
                <div className="label-text">
                  <p className="label-code">{l.code}</p>
                  <p className="label-title">{l.title}</p>
                  {l.subtitle && <p className="label-sub">{l.subtitle}</p>}
                  <div className="label-bar" dangerouslySetInnerHTML={{ __html: l.barcode }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
