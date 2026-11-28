import type { TFunction } from "i18next";
import { formatDate } from "@/lib/formatters";

const WEEKDAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const MONTH_FULL_KEYS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_SHORT_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * Format interval type ID to human-readable string
 * @param intervalTypeId - The raw interval type ID
 * @param t - Translation function from the "planning" namespace
 */
export function formatIntervalTypeId(
  intervalTypeId: string,
  t: TFunction
): string {
  // Daily: YYYY-MM-DD -> "Nov 26"
  if (/^\d{4}-\d{2}-\d{2}$/.test(intervalTypeId)) {
    const date = new Date(intervalTypeId);
    return formatDate(date, {
      month: "short",
      day: "numeric",
    });
  }

  // Weekly: YYYY_D0X -> "Monday"
  if (/^\d{4}_D0[1-7]$/.test(intervalTypeId)) {
    const dayNum = parseInt(intervalTypeId.slice(-1));
    const dayKey = WEEKDAY_KEYS[dayNum - 1];
    return dayKey ? t(`weekdays.${dayKey}`) : intervalTypeId;
  }

  // Monthly: YYYY_MM_W0X -> "W4 Apr"
  if (/^\d{4}_\d{2}_W0[1-5]$/.test(intervalTypeId)) {
    const parts = intervalTypeId.split("_");
    if (parts.length >= 3) {
      const month = parseInt(parts[1]!);
      const week = parts[2]!.slice(-1);
      const monthKey = MONTH_FULL_KEYS[month - 1];

      return t("formatters.weekLabel", {
        week,
        month: monthKey ? t(`monthsFull.${monthKey}`) : "",
      });
    }
  }

  // Yearly Month: YYYY_MXX -> "Jan 24"
  if (/^\d{4}_M(0[1-9]|1[0-2])$/.test(intervalTypeId)) {
    const parts = intervalTypeId.split("_");
    if (parts.length >= 2) {
      const year = parts[0]?.slice(2); // 2024 -> 24
      const monthStr = parts[1];
      const month = parseInt(monthStr!.slice(1));
      const monthKey = MONTH_SHORT_KEYS[month - 1];

      return t("formatters.yearMonthLabel", {
        month: monthKey ? t(`monthsShort.${monthKey}`) : "",
        year,
      });
    }
  }

  // Yearly Quarter: YYYY_Q0X -> "Jan - Mar"
  if (/^\d{4}_Q0[1-4]$/.test(intervalTypeId)) {
    const parts = intervalTypeId.split("_");
    if (parts.length >= 2) {
      const quarter = parts[1]; // Q01
      const quarterNum = parseInt(quarter!.slice(2));

      switch (quarterNum) {
        case 1:
          return t("quarterRanges.q1");
        case 2:
          return t("quarterRanges.q2");
        case 3:
          return t("quarterRanges.q3");
        case 4:
          return t("quarterRanges.q4");
        default:
          return t("formatters.quarterFallback", { num: quarterNum });
      }
    }
  }

  return intervalTypeId;
}

/**
 * Format interval type to display label
 * @param intervalType - The raw interval type
 * @param t - Translation function from the "planning" namespace
 */
export function formatIntervalType(intervalType: string, t: TFunction): string {
  switch (intervalType) {
    case "daily":
      return t("intervalTypeLabel.daily");
    case "weekly":
      return t("intervalTypeLabel.weekly");
    case "monthly":
      return t("intervalTypeLabel.monthly");
    case "yearly_month":
      return t("intervalTypeLabel.yearlyMonth");
    case "yearly_quarter":
      return t("intervalTypeLabel.yearlyQuarter");
    default:
      return intervalType;
  }
}
