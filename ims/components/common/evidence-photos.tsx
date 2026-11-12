"use client";

import { useEffect, useRef, useState } from "react";
import { shrinkPhoto } from "@/lib/photo";
import { newId } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type LocalPhoto = { id: string; blob: Blob };

function Preview({ photo }: { photo: LocalPhoto }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const u = URL.createObjectURL(photo.blob);
    if (image.current) image.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [photo.blob]);
  // Local Blobs cannot use the image optimization endpoint.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} alt="Selected evidence" className="h-24 w-32 rounded border object-cover" />;
}

export function EvidencePicker({
  value,
  onChange,
  disabled = false,
  onBusyChange,
}: {
  value: LocalPhoto[];
  onChange: (p: LocalPhoto[]) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <fieldset disabled={disabled || busy} className="flex flex-col gap-2">
      <legend className="font-medium">Photos (optional, up to 3)</legend>
      <p className="text-sm text-muted-foreground">
        Photos are resized before saving. They stay with this submitted record.
      </p>
      <div className="flex flex-wrap gap-2">
        {value.map((p) => (
          <div key={p.id}>
            <Preview photo={p} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(value.filter((x) => x.id !== p.id))}
            >
              Remove photo
            </Button>
          </div>
        ))}
      </div>
      {value.length < 3 && (
        <input
          aria-label="Add evidence photos"
          type="file"
          accept="image/*"
          multiple
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            setError("");
            if (files.length + value.length > 3) {
              setError("Choose up to three photos per item.");
              return;
            }
            setBusy(true);
            onBusyChange?.(true);
            try {
              const added: LocalPhoto[] = [];
              for (const f of files) {
                const blob = await shrinkPhoto(f);
                if (blob.size > 2 * 1024 * 1024)
                  throw new Error("This photo is still larger than 2 MB. Choose another photo.");
                added.push({ id: newId(), blob });
              }
              onChange([...value, ...added]);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not prepare photos.");
            } finally {
              setBusy(false);
              onBusyChange?.(false);
            }
          }}
        />
      )}
      {busy && <p role="status">Preparing photos. Wait before saving.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function EvidenceLinks({ ids }: { ids: string[] }) {
  return ids.length ? (
    <span className="flex flex-wrap gap-2">
      {ids.map((id, i) => (
        <a
          key={id}
          href={`/api/v1/evidence/${id}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline"
        >
          Photo {i + 1}
        </a>
      ))}
    </span>
  ) : null;
}

export async function uploadReturnPhotos(photos: LocalPhoto[], targetId: string, locationId: string) {
  for (const p of photos) {
    const r = await fetch(
      `/api/v1/evidence/${p.id}?kind=RETURN&targetId=${encodeURIComponent(targetId)}&locationId=${encodeURIComponent(locationId)}`,
      {
        method: "PUT",
        headers: { "content-type": p.blob.type },
        body: p.blob,
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    if (!r.ok)
      throw new Error(
        (await r.json().catch(() => null))?.message ?? "Photo upload failed. Retry before confirming the return.",
      );
  }
}
