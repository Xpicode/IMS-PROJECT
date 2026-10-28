const DEFAULT_TZ = process.env.NEXT_PUBLIC_COMPANY_TIMEZONE || "Asia/Manila";

/** "28 Oct 2026, 2:30 PM" in the company timezone (IMS_BUILD_PLAN §3.6). DB values are UTC. */
export function formatDateTime(v: Date | string | null | undefined, timeZone = DEFAULT_TZ) {
  if (!v) return "—";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(new Date(v))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`;
}
