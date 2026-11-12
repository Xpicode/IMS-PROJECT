import { apiFetch } from "@/lib/api-client";

export async function resolveCameraCode(raw: string, type: "item") {
  const hit = await apiFetch<{ type: string; id: string }>(`/api/v1/lookup?code=${encodeURIComponent(raw)}`);
  if (hit.type !== type) throw new Error(`That code is not an ${type}.`);
  return hit.id;
}

export function itemSelectionError(item: { id: string; sku: string }, exclude: string[]) {
  if (exclude.includes(item.id)) return `${item.sku} is already in the list. Change its quantity instead.`;
  return null;
}

/** The loan line for a scanned item that still has some out. */
export function outstandingReturnLine<T extends { itemId: string; status: string }>(lines: T[], itemId: string) {
  const line = lines.find((l) => l.itemId === itemId && l.status === "OUT");
  if (!line) throw new Error("That item is not out on this loan.");
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
