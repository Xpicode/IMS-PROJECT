"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { apiFetch, ApiClientError, messageOf } from "@/lib/api-client";

type Unit = { id: string; code: string; name: string; count: number };
type Category = { id: string; name: string; count: number };
type Kind = "unit" | "category";
type Row = { id: string; code: string; name: string; count: number };

/** Units and categories used by items and by the CSV import. */
export function CatalogManager({ units, categories }: { units: Unit[]; categories: Category[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section
        kind="unit"
        title="Units"
        hint="How an item is counted. The CSV import uses the code, like pcs."
        rows={units}
      />
      <Section
        kind="category"
        title="Categories"
        hint="Groups for filtering and reports."
        rows={categories.map((c) => ({ ...c, code: "" }))}
      />
    </div>
  );
}

function Section({ kind, title, hint, rows }: { kind: Kind; title: string; hint: string; rows: Row[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-muted-foreground">{hint}</p>
      </div>
      <CatalogForm kind={kind} />
      <ul className="divide-y surface">
        {rows.length === 0 && <li className="p-4 text-muted-foreground">None yet.</li>}
        {rows.map((r) =>
          editing === r.id ? (
            <li key={r.id}>
              <CatalogForm kind={kind} row={r} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={r.id} className="flex items-center justify-between gap-3 p-4">
              <span className="min-w-0">
                <span className="font-medium">{kind === "unit" ? r.code : r.name}</span>{" "}
                {kind === "unit" && <span className="text-muted-foreground">{r.name}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-muted-foreground tabular-nums">
                  {r.count} {r.count === 1 ? "item" : "items"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${kind === "unit" ? r.code : r.name}`}
                  onClick={() => setEditing(r.id)}
                >
                  <Pencil aria-hidden />
                </Button>
              </span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/** Adds a unit or category; with `row`, edits that one instead. */
function CatalogForm({ kind, row, onDone }: { kind: Kind; row?: Row; onDone?: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState(row?.code ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const p = `${kind === "unit" ? "u" : "c"}-${row?.id ?? "new"}`;
  const label = kind === "unit" ? code.trim().toLowerCase() : name.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const base = kind === "unit" ? "/api/v1/units" : "/api/v1/categories";
      await apiFetch(row ? `${base}/${row.id}` : base, {
        method: row ? "PATCH" : "POST",
        body: kind === "unit" ? { code, name } : { name },
      });
      toast.success(row ? `Saved ${label}.` : `Added ${label}.`);
      if (row) onDone?.();
      else {
        setCode("");
        setName("");
      }
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
      className="flex flex-col gap-3 surface p-4 sm:flex-row sm:flex-wrap sm:items-start"
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
      {row ? (
        <div className="flex gap-2 sm:mt-7">
          <Button type="submit" loading={busy}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button type="submit" variant="outline" loading={busy} className="sm:mt-7">
          <Plus aria-hidden /> Add {kind}
        </Button>
      )}
      {errors.root && (
        <p className="text-sm font-medium text-destructive sm:basis-full" role="alert">
          {errors.root}
        </p>
      )}
    </form>
  );
}
