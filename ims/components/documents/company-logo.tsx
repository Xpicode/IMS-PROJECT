"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteCompanyLogo, uploadCompanyLogo } from "@/lib/photo";

/** Documents page (administrators): the logo printed at the top of every new form. */
export function CompanyLogo({ version, companyName }: { version: string | null; companyName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "upload" | "remove", job: () => Promise<void>, done: string) {
    setBusy(kind);
    setError(null);
    try {
      await job();
      toast.success(done);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="logo-h" className="mb-4 flex flex-col gap-3 surface p-4 sm:flex-row sm:items-center">
      <div className="flex h-16 w-40 shrink-0 items-center justify-center rounded-lg border bg-white p-2">
        {version ? (
          // eslint-disable-next-line @next/next/no-img-element -- private, signed-in image from our API
          <img src={`/api/v1/settings/logo?v=${version}`} alt="Company logo" className="max-h-full max-w-full" />
        ) : (
          <span className="text-sm text-muted-foreground">No logo</span>
        )}
      </div>
      <div className="flex-1">
        <h2 id="logo-h" className="font-semibold">
          Logo on forms
        </h2>
        <p className="text-sm text-muted-foreground">
          Printed next to “{companyName}” at the top of every new form. Forms already made keep how they look.
        </p>
        {error && (
          <p className="mt-1 text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run("upload", () => uploadCompanyLogo(f), "Logo saved. New forms will show it.");
          }}
        />
        <Button
          type="button"
          variant="outline"
          loading={busy === "upload"}
          disabled={!!busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus aria-hidden /> {version ? "Change logo" : "Add logo"}
        </Button>
        {version && (
          <Button
            type="button"
            variant="ghost"
            loading={busy === "remove"}
            disabled={!!busy}
            onClick={() => {
              if (window.confirm("Remove the logo from new forms?"))
                void run("remove", deleteCompanyLogo, "Logo removed.");
            }}
          >
            <Trash2 aria-hidden /> Remove
          </Button>
        )}
      </div>
    </section>
  );
}
