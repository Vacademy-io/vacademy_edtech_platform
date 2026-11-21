import { shiftDay, type ReportPeriod } from './report-period';

/*
 * The weekly view's period: the last 7 days ending on a chosen day. The week is named by its last
 * day (`to`), which the URL carries as `date`; the first day is always 6 days before it. The week
 * never reaches into the future, and it never starts before the first day of the 90-day window,
 * because the server refuses a period that does.
 */

export const WEEK_DAYS = 7;

/** The 7 days ending on `to`, both included. */
export const weekEndingOn = (to: string): ReportPeriod => ({
    from: shiftDay(to, -(WEEK_DAYS - 1)),
    to,
});

/** The earliest last day a week can have: the whole week must lie inside the window starting `minDate`. */
export const earliestWeekEnd = (minDate: string): string => shiftDay(minDate, WEEK_DAYS - 1);

/** A last day kept inside [earliest week end, today]. */
export const clampWeekEnd = (to: string, minDate: string, today: string): string => {
    const earliest = earliestWeekEnd(minDate);
    return to > today ? today : to < earliest ? earliest : to;
};

/** The week before (-1) or after (1) this one, stopping at today and at the start of the window. */
export const shiftWeek = (to: string, direction: -1 | 1, minDate: string, today: string): string =>
    clampWeekEnd(shiftDay(to, direction * WEEK_DAYS), minDate, today);

/** False where an arrow has nowhere to go: the week ends today, or starts at the window's edge. */
export const canShiftWeek = (
    to: string,
    direction: -1 | 1,
    minDate: string,
    today: string
): boolean => (direction < 0 ? to > earliestWeekEnd(minDate) : to < today);
