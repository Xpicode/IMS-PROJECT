import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { idParam, json, route } from "@/lib/api/route";
import { uploadEvidence, viewEvidence } from "@/lib/evidence";
import { MAX_PHOTO_BYTES } from "@/lib/inventory/item-photo";

export const GET = route({ auth: true }, async ({ user, params }) => {
  const p = await viewEvidence(user, idParam(params, "id", "photo"));
  return new Response(p.bytes, {
    headers: {
      "content-type": p.type,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
});

export const PUT = route({ auth: true }, async ({ req, user, params }) => {
  const id = idParam(params, "id", "photo");
  const url = new URL(req.url);
  const parsed = z
    .object({
      kind: z.enum(["COUNT", "RETURN"]),
      targetId: z.string().uuid(),
      locationId: z.string().uuid().optional(),
    })
    .safeParse({
      kind: url.searchParams.get("kind"),
      targetId: url.searchParams.get("targetId"),
      locationId: url.searchParams.get("locationId") ?? undefined,
    });
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "Choose a valid photo target.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES)
    throw new ApiError("VALIDATION_FAILED", "The photo is larger than 2 MB.", { status: 413 });
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError("VALIDATION_FAILED", "A photo is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel();
        throw new ApiError("VALIDATION_FAILED", "The photo is larger than 2 MB.", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return json(await uploadEvidence(user, id, parsed.data, Buffer.concat(chunks)), 201);
});
