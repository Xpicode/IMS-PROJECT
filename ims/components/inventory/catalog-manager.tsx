"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";

type Unit = { id: string; code: string; name: string; count: number };
type Category = { id: string; name: string; count: number };
type Row = { id: string; main: string; sub: string; count: number };

/** Units and categories used by items and by the CSV import. */
export function CatalogManager({ units, categories }: { units: Unit[]; categories: Category[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section
        title="Units"
        hint="How an item is counted. The CSV import uses the code, like pcs."
        rows={units.map((u) => ({ id: u.id, main: u.code, sub: u.name, count: u.count }))}
        form={<AddForm kind="unit" />}
      />
      <Section
        title="Categories"
        hint="Groups for filtering and reports."
        rows={categories.map((c) => ({ id: c.id, main: c.name, sub: "", count: c.count }))}
        form={<AddForm kind="category" />}
      />
    </div>
  );
}

function Section({ title, hint, rows, form }: { title: string; hint: string; rows: Row[]; form: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-muted-foreground">{hint}</p>
      </div>
      {form}
      <ul className="divide-y rounded-xl border bg-card">
        {rows.length === 0 && <li className="p-4 text-muted-foreground">None yet.</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 p-4">
            <span>
              <span className="font-medium">{r.main}</span>{" "}
              {r.sub && <span className="text-muted-foreground">{r.sub}</span>}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {r.count} {r.count === 1 ? "item" : "items"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddForm({ kind }: { kind: "unit" | "category" }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const p = kind === "unit" ? "u" : "c";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await apiFetch(kind === "unit" ? "/api/v1/units" : "/api/v1/categories", {
        method: "POST",
        body: kind === "unit" ? { code, name } : { name },
      });
      toast.success(`Added ${kind === "unit" ? code.trim().toLowerCase() : name.trim()}.`);
      setCode("");
      setName("");
      router.refresh();
    } catch (err) {
      const f =
        err instanceof ApiClientError && err.fields
          ? Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]]))
          : {};
      setErrors(Object.keys(f).length ? f : { root: messageOf(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-start"
    >
      {kind === "unit" && (
        <div className="sm:w-32">
          <Field id={`${p}-code`} label="Code" error={errors.code}>
            <Input
              id={`${p}-code`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="pcs"
              autoComplete="off"
              aria-invalid={!!errors.code || undefined}
            />
          </Field>
        </div>
      )}
      <div className="flex-1">
        <Field id={`${p}-name`} label="Name" error={errors.name}>
          <Input
            id={`${p}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "unit" ? "Piece" : "PPE"}
            autoComplete="off"
            aria-invalid={!!errors.name || undefined}
          />
        </Field>
      </div>
      <Button type="submit" variant="outline" loading={busy} className="sm:mt-7">
        <Plus aria-hidden /> Add {kind}
      </Button>
      {errors.root && (
        <p className="text-sm font-medium text-destructive sm:basis-full" role="alert">
          {errors.root}
        </p>
      )}
    </form>
  );
}
