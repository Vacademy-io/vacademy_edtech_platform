/**
 * The Enrollment Date / Next Due Date columns on the payment list.
 *
 * The API sends two shapes: a plain calendar day ("2026-09-28") for DATE columns (the stored
 * enrolment date, an instalment's due date), and a UTC instant ("2026-10-18T18:30:00Z") for
 * timestamps (a subscription's renewal). A plain day must be read as that day wherever the admin
 * is: `new Date("2026-09-28")` is UTC midnight, which is the 27th west of UTC. An instant is shown
 * as the admin's local day, so an IST renewal at 18:30 UTC reads as the next morning's date.
 */

const PLAIN_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The value as a local Date at the start of its day, or null when absent or unreadable. */
export const parsePlanDate = (value: string | null | undefined): Date | null => {
    if (!value) return null;
    const day = PLAIN_DAY.exec(value);
    if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return null;
    return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
};

/** "Sep 28, 2026" — the same style as the Date & Time column. */
export const formatPlanDate = (value: string | null | undefined): string | null => {
    const date = parsePlanDate(value);
    return date
        ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : null;
};

export type DueState = 'overdue' | 'today' | 'upcoming';

/** Where a due day stands against today, by calendar day in the admin's zone. */
export const dueState = (
    value: string | null | undefined,
    now: Date = new Date()
): DueState | null => {
    const due = parsePlanDate(value);
    if (!due) return null;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (due.getTime() < today.getTime()) return 'overdue';
    if (due.getTime() === today.getTime()) return 'today';
    return 'upcoming';
};

/** Whole days from today to the due day (negative when past). */
export const daysUntil = (
    value: string | null | undefined,
    now: Date = new Date()
): number | null => {
    const due = parsePlanDate(value);
    if (!due) return null;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((due.getTime() - today.getTime()) / 86_400_000);
};
