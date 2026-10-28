"use client";

import { useEffect, useRef, useState } from "react";
import { useSerwist } from "@serwist/turbopack/react";
import { Button } from "@/components/ui/button";

/**
 * "New version ready. Update when you finish counting." The new service
 * worker waits; the page reloads only after the person taps Update.
 */
export function UpdateBanner() {
  const { serwist } = useSerwist();
  const [ready, setReady] = useState(false);
  const asked = useRef(false);
  useEffect(() => {
    if (!serwist) return;
    const onWaiting = () => setReady(true);
    const onControlling = () => {
      if (asked.current) window.location.reload();
    };
    serwist.addEventListener("waiting", onWaiting);
    serwist.addEventListener("controlling", onControlling);
    return () => {
      serwist.removeEventListener("waiting", onWaiting);
      serwist.removeEventListener("controlling", onControlling);
    };
  }, [serwist]);
  if (!ready) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 bg-info-soft px-3 py-2 text-sm" role="status">
      <p className="flex-1 font-medium">New version ready. Update when you finish counting.</p>
      <Button
        size="sm"
        onClick={() => {
          asked.current = true;
          serwist?.messageSkipWaiting();
        }}
      >
        Update now
      </Button>
    </div>
  );
}
