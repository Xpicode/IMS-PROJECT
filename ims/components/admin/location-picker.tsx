"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type LocationOption = { id: string; code: string; name: string; isActive: boolean };
export type Assignment = { id: string; access: "FULL" | "VIEW_ONLY" };

/** Pick a user's locations, each with Full or View-only access. Children are included automatically. */
export function LocationPicker({
  options,
  value,
  onChange,
  describedBy,
}: {
  options: LocationOption[];
  value: Assignment[];
  onChange: (v: Assignment[]) => void;
  describedBy?: string;
}) {
  const byId = new Map(value.map((a) => [a.id, a]));
  if (options.length === 0) {
    return <p className="text-muted-foreground">No locations yet. Add locations first, then assign people to them.</p>;
  }
  return (
    <ul className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-lg border" aria-describedby={describedBy}>
      {options.map((o) => {
        const a = byId.get(o.id);
        const cbId = `loc-${o.id}`;
        return (
          <li key={o.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <Checkbox
              id={cbId}
              checked={!!a}
              onCheckedChange={(c) =>
                onChange(c ? [...value, { id: o.id, access: "FULL" }] : value.filter((v) => v.id !== o.id))
              }
            />
            <label htmlFor={cbId} className="min-w-0 flex-1 py-1.5">
              <span className="font-medium">{o.code}</span> · {o.name}
              {!o.isActive && <span className="text-muted-foreground"> (inactive)</span>}
            </label>
            {a && (
              <Select
                value={a.access}
                onValueChange={(access: Assignment["access"]) =>
                  onChange(value.map((v) => (v.id === o.id ? { ...v, access } : v)))
                }
              >
                <SelectTrigger className="w-36" aria-label={`Access at ${o.code}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL">Full</SelectItem>
                  <SelectItem value="VIEW_ONLY">View only</SelectItem>
                </SelectContent>
              </Select>
            )}
          </li>
        );
      })}
    </ul>
  );
}
