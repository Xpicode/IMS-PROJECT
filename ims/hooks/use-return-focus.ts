"use client";

import { useRef } from "react";

/**
 * Our dialogs are opened by our own buttons (controlled `open`), not by a Radix
 * <DialogTrigger>, so Radix has nowhere to send focus on close and drops it on
 * <body>: keyboard users start again at the top of the page. Remember what had
 * focus when the dialog opened and put it back on close.
 *
 *   const rf = useReturnFocus();
 *   <DialogContent {...rf}>
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      // Runs before focus moves into the dialog, so this is still the opener.
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (e: Event) => {
      const el = opener.current;
      opener.current = null;
      if (el && el.isConnected && el !== document.body) {
        e.preventDefault();
        el.focus();
      }
    },
  };
}
