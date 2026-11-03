"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Boxes, ImageOff, Keyboard, MapPin, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/common/status-chip";
import { Scanner } from "@/components/field/scanner";
import { apiFetch } from "@/lib/api-client";
import { itemPhotoUrl } from "@/lib/photo";
import type { AssetStatus } from "@/lib/assets/transitions";

type ItemHit = {
  id: string;
  sku: string;
  name: string;
  trackingType: "STOCK" | "ASSET";
  onHand: number;
  assetCount: number;
  unitCode: string;
  photoPath: string | null;
};
type AssetHit = { id: string; tag: string; status: AssetStatus; item: { name: string } };
type LocHit = { id: string; code: string; name: string };
type Hits = { q: string; items: ItemHit[]; assets: AssetHit[]; locations: LocHit[] };

const SHOW = 5;

/** Office Scan: camera or typed code → opens the item, asset, or location (via /find). */
export function ScanLookup() {
  const router = useRouter();
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const [hits, setHits] = useState<Hits | null>(null);
  const locs = useRef<LocHit[] | null>(null); // loaded once, filtered here (few locations)
  const open = (c: string) => {
    if (c.trim()) router.push(`/find?q=${encodeURIComponent(c.trim())}`);
  };

  // While typing: matching items, assets and locations under the box (part of a SKU, tag or name).
  const q = code.trim();
  const searching = typing && q.length >= 2;
  useEffect(() => {
    if (!searching) return;
    let alive = true;
    const t = setTimeout(async () => {
      const e = encodeURIComponent(q);
      const [items, assets, allLocs] = await Promise.all([
        apiFetch<{ rows: ItemHit[] }>(`/api/v1/items?q=${e}&pageSize=${SHOW}`).catch(() => ({ rows: [] })),
        apiFetch<{ rows: AssetHit[] }>(`/api/v1/assets?q=${e}`).catch(() => ({ rows: [] })),
        locs.current ??
          apiFetch<{ data: LocHit[] }>("/api/v1/locations").then(
            (r) => r.data,
            () => [] as LocHit[],
          ),
      ]);
      if (!alive) return;
      locs.current = allLocs;
      const low = q.toLowerCase();
      setHits({
        q,
        items: items.rows.slice(0, SHOW),
        assets: assets.rows.slice(0, SHOW),
        locations: allLocs
          .filter((l) => l.code.toLowerCase().includes(low) || l.name.toLowerCase().includes(low))
          .slice(0, SHOW),
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [searching, q]);
  const shown = searching && hits?.q === q ? hits : null;
  const count = shown ? shown.items.length + shown.assets.length + shown.locations.length : 0;

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {!typing && <Scanner onCode={open} />}
      {typing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            open(code);
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="office-code" className="font-medium">
            Type the code
          </label>
          <input
            id="office-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            placeholder="SKU, tag, location, or barcode"
            aria-describedby="office-code-matches"
            className="h-12 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p id="office-code-matches" className="sr-only" role="status">
            {shown ? (count ? `${count} matches below` : "No matches") : ""}
          </p>
          {shown &&
            (count === 0 ? (
              <p className="rounded-lg border border-dashed bg-card px-3 py-3 text-muted-foreground">
                Nothing matches &quot;{q}&quot;. Check the code, or press Find to search all items.
              </p>
            ) : (
              <div className="flex flex-col overflow-hidden surface">
                <Group title="Items" show={shown.items.length > 0}>
                  {shown.items.map((i) => (
                    <Hit key={i.id} href={`/stock/items/${i.id}`}>
                      {i.photoPath ? (
                        // eslint-disable-next-line @next/next/no-img-element -- private, signed-in image from our API
                        <img
                          src={itemPhotoUrl(i.id, i.photoPath)}
                          alt=""
                          className="size-10 shrink-0 rounded-md border bg-muted object-cover"
                        />
                      ) : (
                        <Thumb icon={i.trackingType === "STOCK" ? Boxes : ImageOff} />
                      )}
                      <Main title={i.name} sub={i.sku} />
                      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                        {i.trackingType === "STOCK" ? `${i.onHand} ${i.unitCode}` : `${i.assetCount} tagged`}
                      </span>
                    </Hit>
                  ))}
                </Group>
                <Group title="Assets" show={shown.assets.length > 0}>
                  {shown.assets.map((a) => (
                    <Hit key={a.id} href={`/assets/${a.id}`}>
                      <Thumb icon={Wrench} />
                      <Main title={a.tag} sub={a.item.name} />
                      <StatusChip kind="asset" status={a.status} />
                    </Hit>
                  ))}
                </Group>
                <Group title="Locations" show={shown.locations.length > 0}>
                  {shown.locations.map((l) => (
                    <Hit key={l.id} href={`/locations?q=${encodeURIComponent(l.code)}`}>
                      <Thumb icon={MapPin} />
                      <Main title={l.code} sub={l.name} />
                    </Hit>
                  ))}
                </Group>
              </div>
            ))}
          <Button type="submit">Find</Button>
          <Button type="button" variant="outline" onClick={() => setTyping(false)}>
            Use the camera
          </Button>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setTyping(true)}>
          <Keyboard aria-hidden /> Type code instead
        </Button>
      )}
    </div>
  );
}

function Group({ title, show, children }: { title: string; show: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <section aria-label={title} className="border-b last:border-b-0">
      <h2 className="bg-muted/60 px-3 py-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}

function Hit({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50">
        {children}
      </Link>
    </li>
  );
}

function Thumb({ icon: Icon }: { icon: typeof Boxes }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

function Main({ title, sub }: { title: string; sub: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{title}</span>
      <span className="block truncate text-sm text-muted-foreground">{sub}</span>
    </span>
  );
}
