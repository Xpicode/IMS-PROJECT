"use client";

import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";

/** Install-help sheet with separate Android and iPhone steps. */
export function InstallHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Install IMS on this phone"
      description="Installing puts IMS on your home screen and keeps it working offline."
      footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}
    >
      <div className="flex flex-col gap-4 pb-2 text-[15px]">
        <section>
          <h3 className="font-semibold">Android (Chrome)</h3>
          <ol className="mt-1 list-decimal pl-5">
            <li>Open IMS in Chrome and sign in.</li>
            <li>Tap the ⋮ menu (top right).</li>
            <li>
              Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.
            </li>
            <li>Open IMS from the home screen icon.</li>
          </ol>
        </section>
        <section>
          <h3 className="font-semibold">iPhone (Safari)</h3>
          <ol className="mt-1 list-decimal pl-5">
            <li>Open IMS in Safari (not Chrome) and sign in.</li>
            <li>Tap the Share button (square with an arrow).</li>
            <li>
              Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.
            </li>
            <li>
              Open IMS from the home screen, <b>sign in again</b>, and <b>download your assignment again</b>. On iPhone
              the installed app has its own storage, separate from Safari.
            </li>
          </ol>
        </section>
        <p className="rounded-lg bg-muted p-3">
          Check it works: turn on airplane mode, open IMS from the home screen, and open your assignment.
        </p>
      </div>
    </ResponsiveDialog>
  );
}
