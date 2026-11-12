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

/** Upload → preview with row-by-row errors → import the valid rows (§9.5). */
export function ImportScreen() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ imported: number; skipped: number } | null>(null);
  const [drag, setDrag] = useState(false);

  function uploadBody(file: File, mode: "preview" | "commit") {
    const body = new FormData();
    body.set("file", file);
    body.set("mode", mode);
    return body;
  }

  async function load(f: File | undefined) {
    if (!f) return;
    if (busy) return;
    setFile(null);
    setError(null);
    setPreview(null);
    setDone(null);
    if (!/\.(xlsx|csv)$/i.test(f.name))
      return setError("Choose an .xlsx or .csv file. Legacy .xls files are not supported.");
    if (f.size > 2_000_000) return setError("The file is larger than 2 MB. Split it into smaller files.");
    setFile(f);
    setBusy(true);
    try {
      setPreview(await apiFetch<Preview>("/api/v1/items/import", { method: "POST", body: uploadBody(f, "preview") }));
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
      setDone(await apiFetch("/api/v1/items/import", { method: "POST", body: uploadBody(file, "commit") }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="flex max-w-xl flex-col items-start gap-4 surface p-6" aria-live="polite">
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
        <p className="text-lg font-medium">{file ? file.name : "Drop an Excel or CSV file here"}</p>
        <input
          ref={input}
          id="csv-file"
          type="file"
          aria-label="Excel or CSV file to import"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="sr-only"
          onChange={(e) => void load(e.target.files?.[0])}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => input.current?.click()} loading={busy && !preview}>
            {file ? "Choose another file" : "Choose file"}
          </Button>
          <Button asChild variant="outline">
            <a href="/api/v1/items/import" download="ims-items-template.xlsx">
              Download Excel template
            </a>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Columns: sku, name, category, unit, min_stock, description, barcode. Units and categories must already exist.
          Replace the example rows. Excel imports read the first worksheet only, with headers in row 1; use text cells
          for SKU and barcode to retain leading zeros. No formulas, quantities, or extra columns. Maximum 2 MB and 2,000
          rows.
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
          <ol className="flex flex-col divide-y surface" aria-label="Rows">
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
                      {[r.data.unit, r.data.category].filter(Boolean).join(" · ")}
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
