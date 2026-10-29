import "server-only";
import { createHash, randomBytes } from "node:crypto";

export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

/** URL-safe random token with 256 bits of entropy. */
export const randomToken = () => randomBytes(32).toString("base64url");

/** Stable JSON (sorted keys) so equal payloads hash equally. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}
