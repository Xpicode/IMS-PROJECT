import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileCheck2,
  FileWarning,
  Loader2,
  type LucideIcon,
  Minus,
  PackageX,
  ShieldAlert,
  ArrowUpRight,
  Wrench,
  XCircle,
  CloudUpload,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The single source of truth for status colors and icons (IMS_BUILD_PLAN §3.2).
 * Status is always color + icon + word, never color alone (principle 7).
 */
export type Tone = "success" | "warning" | "danger" | "neutral" | "info";
type Def = { label: string; tone: Tone; icon: LucideIcon; strike?: boolean };

const STATUSES = {
  asset: {
    AVAILABLE: { label: "Available", tone: "success", icon: CheckCircle2 },
    BORROWED: { label: "Borrowed", tone: "warning", icon: ArrowUpRight },
    UNDER_MAINTENANCE: { label: "Under maintenance", tone: "warning", icon: Wrench },
    NEEDS_REVIEW: { label: "Needs review", tone: "danger", icon: AlertTriangle },
    LOST: { label: "Lost", tone: "danger", icon: XCircle },
    RETIRED: { label: "Retired", tone: "neutral", icon: Minus },
  },
  sync: {
    DRAFT: { label: "Draft on this device", tone: "neutral", icon: CircleDashed },
    PENDING: { label: "Pending sync", tone: "warning", icon: Clock },
    SENDING: { label: "Sending…", tone: "info", icon: Loader2 },
    ACKED: { label: "Received by server", tone: "success", icon: CheckCircle2 },
    CONFLICT: { label: "Conflict", tone: "danger", icon: ShieldAlert },
    FAILED: { label: "Failed – retry", tone: "danger", icon: XCircle },
  },
  document: {
    DRAFT: { label: "Draft", tone: "neutral", icon: CircleDashed },
    CONFIRMED: { label: "Confirmed", tone: "success", icon: CheckCircle2 },
    PDF_READY: { label: "PDF ready", tone: "success", icon: FileCheck2 },
    PDF_FAILED: { label: "PDF failed – retry", tone: "danger", icon: FileWarning },
    VOID: { label: "Void", tone: "neutral", icon: Ban, strike: true },
  },
  stock: {
    OK: { label: "OK", tone: "success", icon: CheckCircle2 },
    LOW: { label: "Low", tone: "warning", icon: AlertTriangle },
    OUT: { label: "Out", tone: "danger", icon: PackageX },
  },
  user: {
    ACTIVE: { label: "Active", tone: "success", icon: CheckCircle2 },
    INACTIVE: { label: "Inactive", tone: "neutral", icon: Minus },
  },
  location: {
    ACTIVE: { label: "Active", tone: "success", icon: CheckCircle2 },
    INACTIVE: { label: "Inactive", tone: "neutral", icon: Minus },
  },
  upload: {
    // Shown in the top bar until the real outbox arrives (Phase 4).
    ONLINE: { label: "Online", tone: "success", icon: CloudUpload },
    OFFLINE: { label: "Offline", tone: "danger", icon: XCircle },
  },
} satisfies Record<string, Record<string, Def>>;

export type StatusKind = keyof typeof STATUSES;
export type StatusOf<K extends StatusKind> = keyof (typeof STATUSES)[K];

export const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success-soft text-success border-success/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  neutral: "bg-neutral-soft text-neutral border-neutral/30",
  info: "bg-info-soft text-info border-info/30",
};

export function StatusChip<K extends StatusKind>({
  kind,
  status,
  className,
}: {
  kind: K;
  status: StatusOf<K>;
  className?: string;
}) {
  const def = (STATUSES[kind] as Record<string, Def>)[status as string];
  if (!def) return <span className={className}>{String(status)}</span>;
  const Icon = def.icon;
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-sm font-medium whitespace-nowrap",
        TONE_CLASSES[def.tone],
        def.strike && "line-through",
        className,
      )}
    >
      <Icon className={cn("size-4 shrink-0", status === "SENDING" && "animate-spin")} aria-hidden />
      {def.label}
    </span>
  );
}

/** Every chip, for the /dev/ui style guide. */
export const ALL_STATUSES = Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [k, Object.keys(v)])) as {
  [K in StatusKind]: StatusOf<K>[];
};
