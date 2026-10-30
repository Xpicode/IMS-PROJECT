/** Item photos in the browser: shrink, upload, and the URL to show one. */

export const itemPhotoUrl = (itemId: string, photoPath: string) =>
  `/api/v1/items/${itemId}/photo?v=${encodeURIComponent(photoPath.split("/").pop() ?? "")}`;

/**
 * Phone photos are 3–12 MB; shrink to at most `max` px as JPEG (~200 KB). Drawing it
 * also turns formats the browser can show (iPhone HEIC in Safari) into JPEG.
 */
export async function shrinkPhoto(file: File, max = 1280): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("This photo can't be read. Take a new photo, or use a JPEG or PNG.");
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok, fail) =>
      c.toBlob((b) => (b ? ok(b) : fail(new Error("The photo could not be prepared. Try again."))), "image/jpeg", 0.85),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadItemPhoto(itemId: string, file: File) {
  const body = await shrinkPhoto(file);
  const r = await fetch(`/api/v1/items/${itemId}/photo`, {
    method: "PUT",
    headers: { "content-type": body.type },
    body,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? "The photo was not saved. Try again.");
}

export async function deleteItemPhoto(itemId: string) {
  const r = await fetch(`/api/v1/items/${itemId}/photo`, { method: "DELETE" });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? "The photo was not removed. Try again.");
}
