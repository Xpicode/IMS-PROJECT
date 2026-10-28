/**
 * Asset status rules (spec §9.4). Pure: used by the server service and by the
 * status screen to offer only valid choices.
 *
 * `via` says which workflow is asking:
 * - "release": a confirmed borrowing release (Phase 5)
 * - "return": a confirmed return inspection (Phase 5)
 * - "manual": a supervisor's status change on the asset screen
 */
export type AssetStatus = "AVAILABLE" | "BORROWED" | "UNDER_MAINTENANCE" | "NEEDS_REVIEW" | "LOST" | "RETIRED";
export type TransitionVia = "manual" | "release" | "return";

const RULES: Record<AssetStatus, Partial<Record<AssetStatus, TransitionVia[]>>> = {
  AVAILABLE: {
    BORROWED: ["release"],
    UNDER_MAINTENANCE: ["manual"],
    NEEDS_REVIEW: ["manual"],
    LOST: ["manual"],
    RETIRED: ["manual"],
  },
  BORROWED: {
    AVAILABLE: ["return"],
    UNDER_MAINTENANCE: ["return"],
    NEEDS_REVIEW: ["return"],
    LOST: ["manual"],
  },
  UNDER_MAINTENANCE: { AVAILABLE: ["manual"], NEEDS_REVIEW: ["manual"], LOST: ["manual"], RETIRED: ["manual"] },
  NEEDS_REVIEW: { AVAILABLE: ["manual"], UNDER_MAINTENANCE: ["manual"], LOST: ["manual"], RETIRED: ["manual"] },
  // A found asset is checked before it is used again.
  LOST: { NEEDS_REVIEW: ["manual"], RETIRED: ["manual"] },
  RETIRED: {},
};

const LABEL: Record<AssetStatus, string> = {
  AVAILABLE: "Available",
  BORROWED: "Borrowed",
  UNDER_MAINTENANCE: "Under maintenance",
  NEEDS_REVIEW: "Needs review",
  LOST: "Lost",
  RETIRED: "Retired",
};

/** null when allowed; otherwise a plain-language reason (what happened + what to do). */
export function checkTransition(from: AssetStatus, to: AssetStatus, via: TransitionVia): string | null {
  if (from === to) return `This asset is already ${LABEL[to].toLowerCase()}.`;
  if (from === "RETIRED") return "This asset is retired. Retired assets can't change status or be borrowed.";
  const allowedVia = RULES[from][to];
  if (!allowedVia)
    return `An asset that is ${LABEL[from].toLowerCase()} can't go straight to ${LABEL[to].toLowerCase()}.`;
  if (allowedVia.includes(via)) return null;
  if (allowedVia.includes("release"))
    return "Borrowing needs a confirmed release. Use Borrowing to release this asset.";
  if (allowedVia.includes("return"))
    return "A borrowed asset comes back through a return inspection. Use Borrowing to record the return.";
  return "This change isn't allowed here.";
}

export function allowedNextStatuses(from: AssetStatus, via: TransitionVia): AssetStatus[] {
  return (Object.keys(RULES[from]) as AssetStatus[]).filter((to) => checkTransition(from, to, via) === null);
}
