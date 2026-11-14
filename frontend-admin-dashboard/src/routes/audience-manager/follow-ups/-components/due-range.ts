/**
 * Due-date filter for the open buckets (Pending / Today / Upcoming / All).
 *
 * Two yyyy-MM-dd inputs, either of which may be blank: only From means "due on or after",
 * only To means "due on or before". Read in the user's clock, like the bucket windows,
 * and narrowed into the bucket's own window rather than replacing it — so Pending plus
 * 1–7 Oct is what was overdue in that week, and All plus a range is the whole range.
 */
export const dueDateWindow = (from: string, to: string): { from?: string; to?: string } => {
    const start = from ? new Date(`${from}T00:00:00`) : undefined;
    // Midnight the morning after `to`: the backend compares schedule_time < to, so this
    // keeps the last day whole.
    const end = to ? new Date(`${to}T00:00:00`) : undefined;
    end?.setDate(end.getDate() + 1);
    return {
        from: start && !Number.isNaN(start.getTime()) ? start.toISOString() : undefined,
        to: end && !Number.isNaN(end.getTime()) ? end.toISOString() : undefined,
    };
};

/** File-name suffix for the range, e.g. `_2026-10-01_to_2026-10-07`; empty when unset. */
export const dateRangeFileSuffix = (from: string, to: string): string =>
    from || to ? `_${from || 'start'}_to_${to || 'end'}` : '';
