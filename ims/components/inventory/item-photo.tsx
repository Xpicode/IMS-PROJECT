"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteItemPhoto, itemPhotoUrl, uploadItemPhoto } from "@/lib/photo";

/** Item page: the photo, plus Add / Change / Remove for people who can edit items. */
export function ItemPhoto({
  itemId,
  name,
  photoPath,
  canManage,
}: {
  itemId: string;
  name: string;
  photoPath: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!photoPath && !canManage) return null;

  async function run(kind: "upload" | "remove", job: () => Promise<void>, done: string) {
    setBusy(kind);
    setError(null);
    try {
      await job();
      toast.success(done);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Photo" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      {photoPath ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, signed-in image from our API
        <img
          src={itemPhotoUrl(itemId, photoPath)}
          alt={`Photo of ${name}`}
          className="aspect-square w-full rounded-lg bg-muted object-contain"
        />
      ) : (
        <div className="flex aspect-[2/1] w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted text-muted-foreground">
          <ImageOff className="size-8" aria-hidden />
          <span>No photo yet</span>
        </div>
      )}
      {error && (
        <p className="font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void run("upload", () => uploadItemPhoto(itemId, f), "Photo saved.");
            }}
          />
          <Button
            type="button"
            variant="outline"
            loading={busy === "upload"}
            disabled={!!busy}
            onClick={() => input.current?.click()}
          >
            <Camera aria-hidden /> {photoPath ? "Change photo" : "Add photo"}
          </Button>
          {photoPath && (
            <Button
              type="button"
              variant="ghost"
              loading={busy === "remove"}
              disabled={!!busy}
              onClick={() => {
                if (window.confirm(`Remove the photo of ${name}?`))
                  void run("remove", () => deleteItemPhoto(itemId), "Photo removed.");
              }}
            >
              <Trash2 aria-hidden /> Remove
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
