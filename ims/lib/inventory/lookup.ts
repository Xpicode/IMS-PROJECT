import "server-only";
import { prisma } from "@/lib/db/prisma";
import { can, requireAccess, type AccessUser } from "@/lib/permissions";
import { parseScan } from "@/lib/codes";

export type Found =
  | { type: "item"; id: string; label: string }
  | { type: "asset"; id: string; label: string }
  | { type: "location"; id: string; label: string };

/**
 * What a scanned or typed code points to, or null. Records outside the
 * user's locations are treated as not found (§12.3).
 * Order: IMS label payload, SKU, asset tag, location code, alternate identifiers.
 */
export async function resolveCode(actor: AccessUser, raw: string): Promise<Found | null> {
  requireAccess(actor, "records.view");
  const scan = parseScan(raw.slice(0, 200));
  if (!scan) return null;

  const item = async (where: { id: string } | { sku: string }) => {
    const i = await prisma.item.findUnique({ where, select: { id: true, sku: true, name: true } });
    return i ? ({ type: "item", id: i.id, label: `${i.sku} · ${i.name}` } as const) : null;
  };
  const asset = async (where: { id: string } | { tag: string }) => {
    const a = await prisma.asset.findUnique({
      where,
      select: { id: true, tag: true, locationId: true, item: { select: { name: true } } },
    });
    return a && can(actor, "records.view", a.locationId)
      ? ({ type: "asset", id: a.id, label: `${a.tag} · ${a.item.name}` } as const)
      : null;
  };
  const location = async (where: { id: string } | { code: string }) => {
    const l = await prisma.location.findUnique({ where, select: { id: true, code: true, name: true } });
    return l && can(actor, "locations.view", l.id)
      ? ({ type: "location", id: l.id, label: `${l.code} · ${l.name}` } as const)
      : null;
  };

  if (scan.kind === "ims") {
    return scan.type === "item"
      ? item({ id: scan.id })
      : scan.type === "asset"
        ? asset({ id: scan.id })
        : location({ id: scan.id });
  }
  const code = scan.code;
  const direct = (await item({ sku: code })) ?? (await asset({ tag: code })) ?? (await location({ code }));
  if (direct) return direct;

  const ids = await prisma.itemIdentifier.findMany({
    where: { code, isActive: true },
    select: { itemId: true, assetId: true, locationId: true },
  });
  for (const x of ids) {
    const hit = x.itemId
      ? await item({ id: x.itemId })
      : x.assetId
        ? await asset({ id: x.assetId })
        : await location({ id: x.locationId! });
    if (hit) return hit;
  }
  return null;
}
