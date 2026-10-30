"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Scanner } from "@/components/field/scanner";

/** Office Scan: camera or typed code → opens the item, asset, or location (via /find). */
export function ScanLookup() {
  const router = useRouter();
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const open = (c: string) => {
    if (c.trim()) router.push(`/find?q=${encodeURIComponent(c.trim())}`);
  };
  return (
    <div className="flex max-w-xl flex-col gap-4">
      {!typing && <Scanner onCode={open} />}
      {typing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            open(code);
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="office-code" className="font-medium">
            Type the code
          </label>
          <input
            id="office-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            placeholder="SKU, tag, location, or barcode"
            className="h-12 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button type="submit">Find</Button>
          <Button type="button" variant="outline" onClick={() => setTyping(false)}>
            Use the camera
          </Button>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setTyping(true)}>
          <Keyboard aria-hidden /> Type code instead
        </Button>
      )}
    </div>
  );
}
