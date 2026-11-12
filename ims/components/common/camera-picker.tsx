"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { Scanner } from "@/components/field/scanner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { messageOf } from "@/lib/api-client";
import { createScanGate } from "@/lib/camera-selection";

type SelectCode = (raw: string, isCurrent: () => boolean) => Promise<boolean>;

export function CameraPicker({ onScan }: { onScan: SelectCode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Camera aria-hidden /> Scan with camera
      </Button>
      {open && <CameraSession onScan={onScan} close={() => setOpen(false)} />}
    </Dialog>
  );
}

function CameraSession({ onScan, close }: { onScan: SelectCode; close: () => void }) {
  const [gate] = useState(createScanGate);
  const [message, setMessage] = useState("Point at the label to select it.");
  useEffect(() => {
    gate.open();
    return () => gate.close();
  }, [gate]);
  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogTitle>Scan to select</DialogTitle>
      <DialogDescription>
        Uses this device&apos;s camera. Scanning only selects; review quantities, conditions and confirm separately. You
        can close this and type or use a USB keyboard scanner instead.
      </DialogDescription>
      <Scanner
        onCode={(raw) => {
          void gate.run(async (isCurrent) => {
            setMessage("Looking up code...");
            try {
              const selected = await onScan(raw, isCurrent);
              if (selected && isCurrent()) {
                gate.close();
                close();
              }
              return selected;
            } catch (e) {
              if (isCurrent()) setMessage(messageOf(e));
              return false;
            }
          });
        }}
      />
      <p role="status" className="text-sm">
        {message}
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          gate.close();
          close();
        }}
      >
        Close camera
      </Button>
    </DialogContent>
  );
}
