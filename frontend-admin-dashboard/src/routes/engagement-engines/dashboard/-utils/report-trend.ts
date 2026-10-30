/*
 * The small day-by-day charts under the headline numbers: which days to name along the bottom
 * and which two numbers to print above each chart.
 */

export interface TrendDay {
    /** yyyy-MM-dd */
    date: string;
    /** "29 Oct" */
    label: string;
    value: number;
    /** The day belongs to the period on screen (the others are context before it). */
    selected: boolean;
}

/**
 * The days to name under the bars. Seven or fewer: the first and the last. More: three
 * evenly spaced up to a month, four beyond, so a 90-day chart is not a smear of dates.
 * Undefined (let the chart decide) when there is a single bar.
 */
export const sparseTicks = (labels: string[]): string[] | undefined => {
    const n = labels.length;
    if (n < 2) return undefined;
    const wanted = n <= 7 ? 2 : n <= 31 ? 3 : 4;
    const picked = Array.from({ length: wanted }, (_, i) =>
        Math.round((i * (n - 1)) / (wanted - 1))
    ).map((index) => labels[index] ?? '');
    return picked.filter((label, i) => label && picked.indexOf(label) === i);
};

export type TrendNote =
    /** One day on screen: the total over every day the chart shows. */
    | { kind: 'window'; value: number }
    /** A range on screen: the average per day of the period. */
    | { kind: 'average'; value: number };

export interface TrendSummary {
    /** The big number: the day's value, or the total over the period. */
    headline: number;
    note: TrendNote;
    /** Total over the days of the period. */
    total: number;
    /** Average per day of the period. */
    average: number;
}

/**
 * The numbers above one small chart. For a single day the big number is that day and the note
 * the total of the week it sits in; for a range the big number is the total over the period
 * and the note the average per day.
 */
export const summarizeTrend = (days: Array<Pick<TrendDay, 'value' | 'selected'>>): TrendSummary => {
    const sum = (list: Array<Pick<TrendDay, 'value'>>) => list.reduce((s, d) => s + d.value, 0);
    const picked = days.filter((d) => d.selected);
    if (picked.length > 1) {
        const total = sum(picked);
        const average = total / picked.length;
        return { headline: total, note: { kind: 'average', value: average }, total, average };
    }
    const day = picked[0] ?? days[days.length - 1];
    const value = day?.value ?? 0;
    return {
        headline: value,
        note: { kind: 'window', value: sum(days) },
        total: value,
        average: value,
    };
};
