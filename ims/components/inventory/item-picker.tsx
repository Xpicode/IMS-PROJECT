"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type PickedItem = {
  id: string;
  sku: string;
  name: string;
  unitCode: string;
  trackingType: "STOCK" | "ASSET";
  onHand?: number;
};

/**
 * Search box that also takes scans (principle 1): type a name/SKU, or scan /
 * type a code and press Enter. A USB/Bluetooth scanner types the code + Enter.
 * shortcut: no camera button yet; camera scanning arrives with the field app (Phase 3).
 */
export function ItemPicker({
  id,
  tracking,
  onPick,
  exclude = [],
  placeholder = "Type or scan an item…",
  autoFocus,
}: {
  id?: string;
  tracking?: "STOCK" | "ASSET";
  onPick: (item: PickedItem) => void;
  exclude?: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedItem[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) return; // results are hidden while the box is empty
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ q: term, pageSize: "8", ...(tracking ? { tracking } : {}) });
        const r = await apiFetch<{ rows: PickedItem[] }>(`/api/v1/items?${p}`);
        if (n === seq.current) {
          setResults(r.rows.filter((x) => !exclude.includes(x.id)));
          setActive(0);
          setMsg(null);
        }
      } catch {
        if (n === seq.current) setMsg("Couldn't search right now. Check your connection.");
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, tracking, exclude]);

  function pick(item: PickedItem) {
    if (exclude.includes(item.id)) {
      setMsg(`${item.sku} is already in the list. Change its quantity instead.`);
      return;
    }
    onPick(item);
    setQ("");
    setResults([]);
    setOpen(false);
    setMsg(null);
  }

  async function enter() {
    const exact = results.find((r) => r.sku.toLowerCase() === q.trim().toLowerCase());
    if (exact || (results.length && open)) return pick(exact ?? results[active]);
    // A scanned code (label payload or manufacturer barcode) may not match by text.
    try {
      const hit = await apiFetch<{ type: string; id: string }>(`/api/v1/lookup?code=${encodeURIComponent(q)}`);
      if (hit.type !== "item") return setMsg("That code is not an item.");
      const item = await apiFetch<PickedItem & { unit: { code: string } }>(`/api/v1/items/${hit.id}`);
      if (tracking && item.trackingType !== tracking) {
        return setMsg(
          tracking === "STOCK"
            ? `${item.sku} is tracked as individual assets, not counted stock.`
            : `${item.sku} is counted stock, not an asset item.`,
        );
      }
      pick({ id: item.id, sku: item.sku, name: item.name, unitCode: item.unit.code, trackingType: item.trackingType });
    } catch {
      setMsg(`Nothing found for "${q.trim()}". Check the code or search by name.`);
    }
  }

  const listId = `${inputId}-list`;
  const shown = q.trim() ? results : [];
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-6 left-3 size-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (q.trim()) void enter();
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="h-12 w-full rounded-lg border border-input bg-card pr-3 pl-10 text-base outline-none focus-visible:border-ring"
      />
      {open && shown.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {shown.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              className={cn(
                "flex min-h-12 cursor-pointer flex-col justify-center rounded-md px-3 py-1.5",
                i === active && "bg-accent text-accent-foreground",
              )}
            >
              <span className="font-medium">{r.name}</span>
              <span className="text-sm text-muted-foreground">
                {r.sku} · {r.unitCode}
              </span>
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <p className="mt-1.5 text-sm font-medium text-destructive" role="alert">
          {msg}
        </p>
      )}
    </div>
  );
}
