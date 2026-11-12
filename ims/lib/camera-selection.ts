import { apiFetch } from "@/lib/api-client";

export async function resolveCameraCode(raw: string, type: "item" | "asset") {
  const hit = await apiFetch<{ type: string; id: string }>(`/api/v1/lookup?code=${encodeURIComponent(raw)}`);
  if (hit.type !== type) throw new Error(`That code is not an ${type}.`);
  return hit.id;
}

export function itemSelectionError(
  item: { id: string; sku: string; trackingType: string },
  tracking: string | undefined,
  exclude: string[],
) {
  if (exclude.includes(item.id)) return `${item.sku} is already in the list. Change its quantity instead.`;
  if (tracking && item.trackingType !== tracking)
    return tracking === "STOCK"
      ? `${item.sku} is tracked as individual assets, not counted stock.`
      : `${item.sku} is counted stock, not an asset item.`;
  return null;
}

export function borrowSelectionError(
  asset: { id: string; tag: string; locationId: string; status: string },
  locationId: string | null,
  selected: string[],
) {
  if (selected.includes(asset.id)) return `${asset.tag} is already on the list.`;
  if (asset.locationId !== locationId) return `${asset.tag} is not at the release location.`;
  if (asset.status !== "AVAILABLE") return `${asset.tag} can't be borrowed (${asset.status}).`;
  return null;
}

export function outstandingReturnLine<T extends { assetId: string; status: string }>(lines: T[], assetId: string) {
  const line = lines.find((l) => l.assetId === assetId && l.status === "OUT");
  if (!line) throw new Error("That asset is not outstanding on this loan.");
  return line;
}

/** One resolution at a time; closing invalidates even a pending network result. */
export function createScanGate() {
  let active = true;
  let busy = false;
  let generation = 0;
  return {
    open() {
      active = true;
      generation++;
    },
    close() {
      active = false;
      generation++;
    },
    async run(select: (isCurrent: () => boolean) => Promise<boolean>) {
      if (!active || busy) return false;
      busy = true;
      const started = generation;
      try {
        return await select(() => active && generation === started);
      } finally {
        busy = false;
      }
    },
  };
}
