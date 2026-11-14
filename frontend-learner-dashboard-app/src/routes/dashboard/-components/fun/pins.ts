/**
 * Facts the Fun announcements card shows, kept pure so they can be tested without a
 * clock. The rules are the classic panel's (DashboardPinsPanel.tsx).
 */

export type PinTone = "high" | "medium" | "low" | "normal";

/** The priority chip's tone; an unknown or missing priority reads as normal. */
export function pinTone(priority: string | null | undefined): PinTone {
  switch (priority) {
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "normal";
  }
}

export type PinTimeLeft = { unit: "days" | "hours"; count: number } | { unit: "lessThanHour" };

/** How long the pin stays up: whole days, else whole hours, else under an hour; null once past or unreadable. */
export function pinTimeLeft(endIso: string | null | undefined, nowMs: number): PinTimeLeft | null {
  if (!endIso) return null;
  const diff = new Date(endIso).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return { unit: "days", count: days };
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return { unit: "hours", count: hours };
  return { unit: "lessThanHour" };
}

/** How many pins show before "Show all": the classic panel's three. */
export const FUN_PINS_SHOWN = 3;
