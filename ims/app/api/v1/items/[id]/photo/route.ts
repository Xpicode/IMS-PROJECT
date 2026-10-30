import { ApiError } from "@/lib/api/errors";
import { idParam, json, route } from "@/lib/api/route";
import { itemPhoto, MAX_PHOTO_BYTES, removeItemPhoto, setItemPhoto } from "@/lib/inventory/item-photo";

/** GET → the item's photo. */
export const GET = route({ auth: true }, async ({ user, params }) => {
  const p = await itemPhoto(user, idParam(params, "id", "item"));
  return new Response(Buffer.from(p.bytes), { headers: { "content-type": p.type } });
});

/** PUT (raw image body: JPEG, PNG or WebP, up to 2 MB) → add or replace the photo. */
export const PUT = route({ auth: true }, async ({ req, user, params, ctx }) => {
  const id = idParam(params, "id", "item");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES)
    throw new ApiError("VALIDATION_FAILED", "The photo is larger than 2 MB.", { status: 413 });
  return json(await setItemPhoto(user, id, new Uint8Array(await req.arrayBuffer()), ctx));
});

/** DELETE → remove the photo. */
export const DELETE = route({ auth: true }, async ({ user, params, ctx }) => {
  await removeItemPhoto(user, idParam(params, "id", "item"), ctx);
  return json({ ok: true });
});
