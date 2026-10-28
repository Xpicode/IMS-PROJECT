/**
 * Scan payloads (spec §6.3): IMS labels encode `ims:<type>:<uuid>`; anything
 * else (SKU, asset tag, manufacturer barcode) is looked up as a plain code.
 * QR values never contain secrets or URLs.
 */
export type LabelType = "item" | "asset" | "location";
export type Scan = { kind: "ims"; type: LabelType; id: string } | { kind: "code"; code: string };

const IMS = /^ims:(item|asset|location):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const labelPayload = (type: LabelType, id: string) => `ims:${type}:${id}`;

/** Trim, upper-case, remove inner whitespace. Used for SKUs, tags, and barcodes. */
export const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

export function parseScan(raw: string): Scan | null {
  const t = raw.trim();
  if (!t) return null;
  const m = IMS.exec(t);
  if (m) return { kind: "ims", type: m[1].toLowerCase() as LabelType, id: m[2].toLowerCase() };
  return { kind: "code", code: normalizeCode(t) };
}
