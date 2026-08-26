export type ComparableChargingSession = {
  id: string;
  chargedAt: string;
  locationType: "home" | "public";
  energyKwh: number;
};

const COPENHAGEN_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Conservative fallback matching for legacy/manual entries without a stable
 * provider id. False negatives are safer than silently discarding a real
 * charging session.
 */
export function likelySameChargingSession(
  stored: ComparableChargingSession,
  incoming: ComparableChargingSession,
): boolean {
  if (stored.id.startsWith("myskoda:")) return false;
  const sameDay = COPENHAGEN_DAY_FORMAT.format(new Date(stored.chargedAt))
    === COPENHAGEN_DAY_FORMAT.format(new Date(incoming.chargedAt));
  const sameLocationType = stored.locationType === incoming.locationType;
  const toleranceKwh = Math.max(0.25, stored.energyKwh * 0.02);
  return sameDay && sameLocationType && Math.abs(stored.energyKwh - incoming.energyKwh) <= toleranceKwh;
}
