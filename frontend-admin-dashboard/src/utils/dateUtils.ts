/**
 * Date utility functions for generating common relative dates
 */

/**
 * Parse a backend timestamp as UTC.
 *
 * Backend services store and serialize timestamps in UTC but without a
 * timezone suffix (e.g. "2026-07-16T17:32:00.123456"). `new Date(...)` would
 * interpret that as *local* time, shifting every displayed time by the user's
 * UTC offset. This helper appends "Z" when no timezone info is present so the
 * value is correctly parsed as UTC; strings that already carry a timezone
 * (Z or ±hh:mm) are parsed as-is.
 */
export const parseUtcDate = (value: string): Date => {
    const hasTimezone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
    // Date-only strings ("2026-07-16") are already parsed as UTC by spec
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (hasTimezone || isDateOnly) return new Date(value);
    return new Date(`${value.replace(' ', 'T')}Z`);
};

/** End dates at least this many years out are treated as "never expires". */
export const NEVER_EXPIRES_AFTER_YEARS = 100;

/**
 * True when a membership end / expiry date is so far away that it stands for
 * lifetime access. Institutes model a course that never lapses as a ONE_TIME
 * plan with a very long validity (e.g. 1000 years), so the UI shows
 * "Never expires" instead of a date in the year 3026.
 */
export const isNeverExpiring = (value?: string | number | Date | null): boolean => {
    if (value === null || value === undefined || value === '') return false;
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    if (Number.isNaN(time)) return false;
    const threshold = new Date();
    threshold.setFullYear(threshold.getFullYear() + NEVER_EXPIRES_AFTER_YEARS);
    return time >= threshold.getTime();
};

/**
 * Get yesterday's date in YYYY-MM-DD format
 * @returns Yesterday's date as ISO string (YYYY-MM-DD)
 */
export const getYesterday = (): string => {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0] || '';
};

/**
 * Get tomorrow's date in YYYY-MM-DD format
 * @returns Tomorrow's date as ISO string (YYYY-MM-DD)
 */
export const getTomorrow = (): string => {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] || '';
};

/**
 * Get today's date in YYYY-MM-DD format
 * @returns Today's date as ISO string (YYYY-MM-DD)
 */
export const getToday = (): string => {
    return new Date().toISOString().split('T')[0] || '';
};

/**
 * Get a date from X days ago in YYYY-MM-DD format
 * @param days Number of days ago (positive number)
 * @returns Date from X days ago as ISO string (YYYY-MM-DD)
 */
export const getDaysAgo = (days: number): string => {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0] || '';
};

/**
 * Get a date from X days in the future in YYYY-MM-DD format
 * @param days Number of days in the future (positive number)
 * @returns Date from X days in the future as ISO string (YYYY-MM-DD)
 */
export const getDaysFromNow = (days: number): string => {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0] || '';
};

/**
 * Get date from 30 days ago in YYYY-MM-DD format
 * This matches your current filter logic for start_date
 * @returns Date from 30 days ago as ISO string (YYYY-MM-DD)
 */
export const get30DaysAgo = (): string => {
    return getDaysAgo(30);
};

/**
 * Get date range for common filter scenarios
 */
export const getDateRanges = {
    /**
     * Get last 30 days date range
     * @returns Object with start_date (30 days ago) and end_date (tomorrow)
     */
    last30Days: () => ({
        start_date: get30DaysAgo(),
        end_date: getTomorrow(),
    }),

    /**
     * Get last 7 days date range
     * @returns Object with start_date (7 days ago) and end_date (tomorrow)
     */
    last7Days: () => ({
        start_date: getDaysAgo(7),
        end_date: getTomorrow(),
    }),

    /**
     * Get current week date range (Monday to Sunday)
     * @returns Object with start_date (start of week) and end_date (end of week)
     */
    currentWeek: () => {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust for Sunday

        const monday = new Date(today.setDate(diff));
        const sunday = new Date(today.setDate(diff + 6));

        return {
            start_date: monday.toISOString().split('T')[0] || '',
            end_date: sunday.toISOString().split('T')[0] || '',
        };
    },

    /**
     * Get current month date range
     * @returns Object with start_date (first day of month) and end_date (last day of month)
     */
    currentMonth: () => {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        return {
            start_date: firstDay.toISOString().split('T')[0] || '',
            end_date: lastDay.toISOString().split('T')[0] || '',
        };
    },
};
