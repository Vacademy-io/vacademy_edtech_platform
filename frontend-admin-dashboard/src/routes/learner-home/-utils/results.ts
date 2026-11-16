/** Pure helpers for the Results tab. */
import type { AckRow } from '../-types/learner-home-types';

/** yyyy-MM-dd of `instant` in `zone`. */
export function dayInZone(instant: Date, zone: string): string {
    // en-CA formats as yyyy-MM-dd.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
}

/** The last `days` days up to today, in the institute's zone (decision Q12), inclusive. */
export function resultsRange(
    days: number,
    zone: string,
    now: Date = new Date()
): { from: string; to: string } {
    const to = dayInZone(now, zone);
    const [y, m, d] = to.split('-').map(Number) as [number, number, number];
    const start = new Date(Date.UTC(y, m - 1, d - (days - 1)));
    return { from: start.toISOString().slice(0, 10), to };
}

/** Click rate as a percentage string, or "–" with no views. */
export function formatCtr(clicks: number, views: number, ctr?: number | null): string {
    const rate = typeof ctr === 'number' ? ctr : views > 0 ? clicks / views : null;
    if (rate === null || !Number.isFinite(rate)) return '–';
    return `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV of the acknowledgement list, built in the browser (spec 8.2). */
export function acksCsv(rows: AckRow[], headers: [string, string, string]): string {
    const lines = [headers.map(csvCell).join(',')];
    for (const r of rows) {
        lines.push([r.full_name ?? '', r.email ?? '', r.acknowledged_at].map(csvCell).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
}
