import "server-only";
import bwipjs from "bwip-js/node";
import { prisma } from "@/lib/db/prisma";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { labelPayload, type LabelType } from "@/lib/codes";
import { scopeLocations } from "@/lib/inventory/items";

export type Label = { id: string; code: string; title: string; subtitle: string; qr: string; barcode: string };

const svg = (bcid: string, text: string, extra: Record<string, unknown> = {}) =>
  bwipjs.toSVG({ bcid, text, ...extra } as Parameters<typeof bwipjs.toSVG>[0]);

/**
 * Labels for items, assets, or locations the user can see. The QR holds only
 * `ims:<type>:<uuid>` (§6.3, no secrets or URLs); Code 128 holds the
 * human-readable code (SKU / tag / location code) for 1D scanners.
 */
export async function buildLabels(actor: AccessUser, type: LabelType, ids: string[]): Promise<Label[]> {
  const scope = requireAccess(actor, "records.view");
  const locs = scopeLocations(scope);
  const want = [...new Set(ids)].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 240);
  let rows: { id: string; code: string; title: string; subtitle: string }[] = [];
  if (type === "item") {
    const items = await prisma.item.findMany({
      where: { id: { in: want } },
      select: { id: true, sku: true, name: true, unit: { select: { code: true } } },
    });
    rows = items.map((i) => ({ id: i.id, code: i.sku, title: i.name, subtitle: `Unit: ${i.unit.code}` }));
  } else if (type === "asset") {
    const assets = await prisma.asset.findMany({
      where: { id: { in: want }, ...(locs ? { locationId: { in: locs } } : {}) },
      select: { id: true, tag: true, serialNumber: true, item: { select: { name: true } } },
    });
    rows = assets.map((a) => ({
      id: a.id,
      code: a.tag,
      title: a.item.name,
      subtitle: a.serialNumber ? `S/N ${a.serialNumber}` : "",
    }));
  } else {
    const l = await prisma.location.findMany({
      where: { id: { in: want.filter((x) => !locs || locs.includes(x)) } },
      select: { id: true, code: true, name: true },
    });
    rows = l.map((x) => ({ id: x.id, code: x.code, title: x.name, subtitle: "Location" }));
  }
  const order = new Map(want.map((x, i) => [x, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return rows.map((r) => ({
    ...r,
    qr: svg("qrcode", labelPayload(type, r.id), { eclevel: "M" }),
    barcode: svg("code128", r.code, { height: 7, includetext: false }),
  }));
}
