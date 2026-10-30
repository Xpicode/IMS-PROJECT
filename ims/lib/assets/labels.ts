/** Display words for asset fields (shared by server and client components). */
export const CONDITION = { GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" } as const;

/** Why an asset can't be borrowed right now, by status ("" when it can). */
export const UNAVAILABLE_REASON: Record<string, string> = {
  AVAILABLE: "",
  BORROWED: "It's already out on a loan. Return it first.",
  UNDER_MAINTENANCE: "It's under maintenance.",
  NEEDS_REVIEW: "It's waiting for review after a return or count.",
  LOST: "It's marked lost.",
  RETIRED: "It's retired.",
};
