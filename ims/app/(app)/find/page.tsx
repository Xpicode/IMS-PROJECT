import { redirect } from "next/navigation";
import { pageAccess } from "@/lib/auth/page";
import { resolveCode } from "@/lib/inventory/lookup";
import { one } from "@/lib/inventory/page-data";

/**
 * Top-bar search / scanner target: an exact code (label QR, SKU, asset tag,
 * location code, barcode) opens that record; anything else searches items.
 */
export default async function FindPage({ searchParams }: PageProps<"/find">) {
  const { user } = await pageAccess("records.view");
  const q = (one((await searchParams).q) ?? "").trim().slice(0, 200);
  if (!q) redirect("/stock");
  const hit = await resolveCode(user, q);
  if (hit?.type === "item") redirect(`/stock/items/${hit.id}`);
  if (hit?.type === "asset") redirect(`/assets/${hit.id}`);
  if (hit?.type === "location") redirect(`/locations?q=${encodeURIComponent(hit.label.split(" · ")[0])}`);
  redirect(`/stock?q=${encodeURIComponent(q)}`);
}
