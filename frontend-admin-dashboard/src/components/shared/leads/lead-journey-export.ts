import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_LEAD_JOURNEY_BATCH } from '@/constants/urls';
import { parseHtmlToString } from '@/lib/utils';

/**
 * One event in a lead's journey — a status/disposition change (category
 * JOURNEY) or a note / call (category ACTIVITY). Shared by the Lead List and
 * Recent Leads CSV exports.
 */
export interface JourneyEvent {
    id: string;
    action_type?: string | null;
    category?: string | null;
    title?: string | null;
    description?: string | null;
    actor_name?: string | null;
    created_at: string;
}

/**
 * Fetch each lead's full journey (oldest-first) keyed by user id. Chunked so a
 * big export doesn't POST thousands of ids in one request.
 */
export async function fetchLeadJourneyBatch(
    userIds: string[],
    chunkSize = 100
): Promise<Record<string, JourneyEvent[]>> {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (!ids.length) return {};
    const out: Record<string, JourneyEvent[]> = {};
    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const res = await authenticatedAxiosInstance({
            method: 'POST',
            url: GET_LEAD_JOURNEY_BATCH,
            data: chunk,
        });
        Object.assign(out, res.data ?? {});
    }
    return out;
}

/** Backend serialises timestamps as bare UTC; render as local yyyy-MM-dd HH:mm. */
export const fmtWhen = (iso: string): string => {
    if (!iso) return '';
    const hasTz = /Z$|[+-]\d{2}:?\d{2}$/i.test(iso);
    const d = new Date(hasTz ? iso : `${iso.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const cleanText = (raw?: string | null): string => {
    if (!raw) return '';
    const t = /<\/?[a-z][^>]*>/i.test(raw) ? parseHtmlToString(raw) : raw;
    return t.replace(/\s+/g, ' ').trim();
};

/**
 * Flatten a lead's journey into one readable multi-line cell:
 *   "2026-07-01 14:03 · Status changed: New → Interested (Aarav)"
 *   "2026-07-01 14:05 · Call: Interested — will enroll (Aarav)"
 *   "2026-07-03 10:12 · Note: Sent fee structure (Meera)"
 * Newlines stay inside the quoted CSV cell.
 */
export function formatJourneyForExport(events: JourneyEvent[] | undefined): string {
    if (!events || events.length === 0) return '';
    return events
        .map((e) => {
            const when = fmtWhen(e.created_at);
            const label = cleanText(e.title) || (e.action_type ?? '').replace(/_/g, ' ');
            const detail = cleanText(e.description);
            const actor = e.actor_name ? ` (${e.actor_name})` : '';
            const body = [label, detail].filter(Boolean).join(': ');
            return `${when} · ${body}${actor}`.trim();
        })
        .join('\n');
}
