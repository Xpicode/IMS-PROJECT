"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Light theme only for the MVP (IMS_BUILD_PLAN §3.1). Toasts are for short
// success messages; errors that need action stay on the page (§3.5).
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="light"
    className="toaster group"
    position="top-center"
    icons={{
      success: <CircleCheckIcon className="size-5 text-success" />,
      info: <InfoIcon className="size-5 text-info" />,
      warning: <TriangleAlertIcon className="size-5 text-warning" />,
      error: <OctagonXIcon className="size-5 text-danger" />,
      loading: <Loader2Icon className="size-5 animate-spin" />,
    }}
    style={
      {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)",
      } as React.CSSProperties
    }
    toastOptions={{ classNames: { toast: "cn-toast text-base" } }}
    {...props}
  />
)

export { Toaster }
