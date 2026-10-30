"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FocusHeading } from "@/components/common/focus-heading";
import { apiFetch, messageOf } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Row = { line: number; ok: boolean; errors: string[]; data: Record<string, string> };
type Preview = { rows: Row[]; validCount: number; errorCount: number };

const TEMPLATE =
  "sku,name,category,unit,tracking_type,min_stock,description,barcode\r\nPPE-0100,Safety Goggles,PPE,pcs,STOCK,10,,\r\nTOOL-GRINDER,Angle Grinder,Tools,pcs,ASSET,0,,\r\n";

/** Upload → preview with row-by-row errors → import the valid rows (§9.5). */
export function ImportScreen() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ imported: number; skipped: number } | null>(null);
  const [drag, setDrag] = useState(false);

  async function load(f: File | undefined) {
    if (!f) return;
    setError(null);
    setPreview(null);
    setDone(null);
    if (!/\.csv$/i.test(f.name)) return setError("Choose a .csv file. In Excel: File → Save As → CSV UTF-8.");
    if (f.size > 2_000_000) return setError("The file is larger than 2 MB. Split it into smaller files.");
    const text = (await f.text()).replace(/^\uFEFF/, "");
    setFile({ name: f.name, text });
    setBusy(true);
    try {
      setPreview(
        await apiFetch<Preview>("/api/v1/items/import", { method: "POST", body: { csv: text, mode: "preview" } }),
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await apiFetch("/api/v1/items/import", { method: "POST", body: { csv: file.text, mode: "commit" } }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="flex max-w-xl flex-col items-start gap-4 rounded-xl border bg-card p-6" aria-live="polite">
        <CheckCircle2 className="size-10 text-success" aria-hidden />
        <FocusHeading as="h2" className="text-2xl font-semibold">
          Imported {done.imported} items
        </FocusHeading>
        {done.skipped > 0 && (
          <p>
            {done.skipped} rows with errors were skipped. Fix them in the file and import it again. Rows that were
            already imported show &quot;already exists&quot; and are skipped.
          </p>
        )}
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/stock">See items</Link>
          </Button>
          <Button variant="outline" onClick={() => (setDone(null), setFile(null), setPreview(null))}>
            Import another file
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void load(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-card p-8 text-center",
          drag && "border-primary bg-primary/5",
        )}
      >
        <FileUp className="size-10 text-muted-foreground" aria-hidden />
        <p className="text-lg font-medium">{file ? file.name : "Drop a CSV file here"}</p>
        <input
          ref={input}
          id="csv-file"
          type="file"
          aria-label="CSV file to import"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => void load(e.target.files?.[0])}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => input.current?.click()} loading={busy && !preview}>
            {file ? "Choose another file" : "Choose file"}
          </Button>
          <Button asChild variant="outline">
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="ims-items-template.csv">
              Download template
            </a>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Columns: sku, name, category, unit, tracking_type (STOCK or ASSET), min_stock, description, barcode. Units and
          categories must already exist.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {preview && (
        <section aria-labelledby="pv-h" className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="pv-h" className="text-xl font-semibold">
              Preview: {preview.validCount} ready, {preview.errorCount} with errors
            </h2>
            <Button onClick={commit} disabled={preview.validCount === 0} loading={busy}>
              Import {preview.validCount} valid {preview.validCount === 1 ? "row" : "rows"}
            </Button>
          </div>
          <ol className="flex flex-col divide-y rounded-xl border bg-card" aria-label="Rows">
            {preview.rows.map((r) => (
              <li
                key={r.line}
                className={cn("flex flex-col gap-1 p-3 sm:flex-row sm:gap-4", !r.ok && "bg-danger-soft")}
              >
                <span className="w-16 shrink-0 text-sm text-muted-foreground">Line {r.line}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">
                    {r.data.sku || "(no SKU)"} · {r.data.name || "(no name)"}{" "}
                    <span className="font-normal text-muted-foreground">
                      {[r.data.unit, r.data.trackingType, r.data.category].filter(Boolean).join(" · ")}
                    </span>
                  </p>
                  {r.ok ? (
                    <p className="text-sm text-success">Ready to import</p>
                  ) : (
                    <ul className="text-sm font-medium text-danger">
                      {r.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
