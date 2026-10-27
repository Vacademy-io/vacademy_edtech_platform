import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { LEAD_FOLLOWUP_HISTORY_BATCH } from '@/constants/urls';

/** One follow-up as the history batch returns it — the CSV only reads these fields. */
export interface FollowUpHistoryItem {
    id: string;
    audience_response_id: string;
    status?: string | null;
    schedule_time?: string | null;
    created_at?: string | null;
    content?: string | null;
    student_response?: string | null;
    follow_up_mode?: string | null;
    next_action?: string | null;
    closer_reason?: string | null;
    created_by_name?: string | null;
    closed_by_name?: string | null;
}

/**
 * Every follow-up of each lead, oldest first, keyed by audience response id. Migrated
 * leads have no timeline, so this is where their counsellors' notes are. Chunked so a
 * page of the export never posts more ids than the backend takes in one call.
 */
export async function fetchFollowUpHistoryBatch(
    instituteId: string,
    audienceResponseIds: string[],
    chunkSize = 200
): Promise<Record<string, FollowUpHistoryItem[]>> {
    const ids = Array.from(new Set(audienceResponseIds.filter(Boolean)));
    if (!instituteId || !ids.length) return {};
    const out: Record<string, FollowUpHistoryItem[]> = {};
    for (let i = 0; i < ids.length; i += chunkSize) {
        const res = await authenticatedAxiosInstance({
            method: 'POST',
            url: LEAD_FOLLOWUP_HISTORY_BATCH,
            params: { instituteId },
            data: ids.slice(i, i + chunkSize),
        });
        Object.assign(out, res.data ?? {});
    }
    return out;
}
