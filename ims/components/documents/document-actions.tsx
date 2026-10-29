"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/common/status-chip";
import { apiFetch, messageOf } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type DocStatus = "PENDING" | "READY" | "PDF_FAILED" | "VOID";
type Info = { id: string; reference: string; status: DocStatus; lastError: string | null; canRetry: boolean };

export const pdfUrl = (id: string, download = false) => `/api/v1/documents/${id}/pdf${download ? "?download=1" : ""}`;

/** Open the PDF in a hidden frame and start the browser's print dialog. */
export function printPdf(id: string) {
  const old = document.getElementById("ims-print-frame");
  old?.remove();
  const f = document.createElement("iframe");
  f.id = "ims-print-frame";
  f.title = "Print document";
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  f.src = pdfUrl(id);
  f.onload = () => {
    try {
      f.contentWindow?.focus();
      f.contentWindow?.print();
    } catch {
      window.open(pdfUrl(id), "_blank", "noopener");
    }
  };
  document.body.appendChild(f);
}

/**
 * View / Download / Print for one official document, or Retry PDF when drawing
 * failed (§13.7: the transaction itself is always saved).
 */
export function DocumentActions({
  documentId,
  size = "default",
  className,
  showStatus = true,
}: {
  documentId: string;
  size?: "default" | "sm";
  className?: string;
  showStatus?: boolean;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<Info>(`/api/v1/documents/${documentId}`).then(setInfo, (e) => setError(messageOf(e)));
  }, [documentId]);

  async function retry() {
    setBusy(true);
    try {
      const r = await apiFetch<Info>(`/api/v1/documents/${documentId}/retry`, { method: "POST" });
      setInfo((i) => (i ? { ...i, status: r.status, lastError: r.lastError } : i));
      if (r.status === "READY") toast.success(`PDF for ${r.reference} is ready.`);
      else toast.error(r.lastError ?? "The PDF still could not be drawn.");
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!info) return <p className="text-sm text-muted-foreground">Loading document…</p>;
  const ready = info.status === "READY";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {showStatus && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <FileText className="size-4 text-muted-foreground" aria-hidden />
          <span className="font-medium">{info.reference}</span>
          <StatusChip kind="document" status={info.status} />
        </p>
      )}
      {info.status === "PDF_FAILED" && (
        <p className="text-sm text-muted-foreground">
          The transaction is saved. Only the PDF failed. {info.lastError ? `(${info.lastError})` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {ready ? (
          <>
            <Button asChild size={size}>
              <a href={pdfUrl(documentId, true)} download>
                <Download aria-hidden /> Download PDF
              </a>
            </Button>
            <Button variant="outline" size={size} onClick={() => printPdf(documentId)}>
              <Printer aria-hidden /> Print
            </Button>
            <Button asChild variant="outline" size={size}>
              <a href={pdfUrl(documentId)} target="_blank" rel="noopener">
                <FileText aria-hidden /> View
              </a>
            </Button>
          </>
        ) : (
          info.canRetry &&
          info.status !== "VOID" && (
            <Button variant="outline" size={size} onClick={retry} loading={busy}>
              <RotateCcw aria-hidden /> Retry PDF
            </Button>
          )
        )}
      </div>
    </div>
  );
}
