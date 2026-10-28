"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type LocationOption = { id: string; code: string; name: string };

export function LocationSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Pick a location",
  exclude,
  invalid,
}: {
  id: string;
  value: string | null;
  onChange: (id: string) => void;
  options: LocationOption[];
  placeholder?: string;
  exclude?: string | null;
  invalid?: boolean;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options
          .filter((o) => o.id !== exclude)
          .map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.code} · {o.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
