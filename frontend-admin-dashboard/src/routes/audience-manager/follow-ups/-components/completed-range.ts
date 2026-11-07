/**
 * Date-range presets for the Completed tile.
 *
 * Same shape the leads pages use (a day-count string, or CUSTOM reading from/to),
 * so the dropdown behaves identically — but a different default: completed work
 * is reviewed day by day, so this opens on today rather than the last 30 days.
 */
export const COMPLETED_CUSTOM_RANGE = 'CUSTOM';
/** '1' = today only. */
export const COMPLETED_DEFAULT_RANGE = '1';

export const COMPLETED_RANGE_PRESETS = ['1', '3', '7', '15'] as const;

const toDateInputValue = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/** yyyy-MM-dd bounds for a preset; '1' is today, '7' is today and the six before it. */
export const completedRangeForPreset = (preset: string): { from: string; to: string } => {
    const n = Number(preset);
    if (!Number.isFinite(n) || n <= 0) return { from: '', to: '' };
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (n - 1));
    return { from: toDateInputValue(start), to: toDateInputValue(now) };
};

/** The window as instants. `to` is exclusive — the backend compares closed_at < to. */
export const completedWindow = (
    range: string,
    customFrom: string,
    customTo: string
): { closedFrom?: string; closedTo?: string } => {
    const { from, to } =
        range === COMPLETED_CUSTOM_RANGE
            ? { from: customFrom, to: customTo }
            : completedRangeForPreset(range);
    if (!from || !to) return {};
    const start = new Date(`${from}T00:00:00`);
    // Midnight the morning after `to`, so the last day is included whole.
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
        ? {}
        : { closedFrom: start.toISOString(), closedTo: end.toISOString() };
};
