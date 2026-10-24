import {
    CREATE_LIVE_SESSION_STEP_1,
    CREATE_LIVE_SESSION_STEP_2,
    CREATE_LIVE_SESSION_BULK,
    GET_LIVE_SESSIONS,
    DELETE_LIVE_SESSION,
    CREATE_PROVIDER_MEETING,
    CREATE_PROVIDER_MEETINGS_FOR_SESSION,
    PROVIDER_MEETING_AVAILABILITY_FOR_SESSION,
    // GET_LIVE_SESSIONS,
} from '@/constants/urls';
import i18next from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { LiveSessionStep1RequestDTO, LiveSessionStep2RequestDTO } from '../../-constants/helper';

// This module has no React context of its own (its exports are called from
// callers' event handlers, not rendered), so read the current locale off the
// shared i18next instance instead of useTranslation — same pattern as
// Payment/utils/utils.ts.
const t = (key: string, options?: Record<string, unknown>): string =>
    i18next.t(`studyLibraryLiveSessionScheduleUtils:${key}`, options) as string;

export interface BulkLiveSessionRequest {
    sessions: LiveSessionStep1RequestDTO[];
    step2_template?: LiveSessionStep2RequestDTO;
    /**
     * Per-row step-2 payloads aligned with {@link sessions}. Takes precedence
     * over {@link step2_template} when present. Length must match `sessions`.
     */
    step2_per_row?: LiveSessionStep2RequestDTO[];
}

export interface BulkLiveSessionRowResult {
    index: number;
    success: boolean;
    session_id?: string;
    title?: string;
    error?: string;
    step2_applied: boolean;
    /**
     * Non-fatal problems with a row that still succeeded — currently
     * instructor identifiers from the CSV that matched nobody in the institute.
     */
    warnings?: string[];
}

export interface BulkLiveSessionResponse {
    total_requested: number;
    total_created: number;
    total_failed: number;
    results: BulkLiveSessionRowResult[];
}

export const createLiveSessionsBulk = async (
    data: BulkLiveSessionRequest
): Promise<BulkLiveSessionResponse> => {
    const response = await authenticatedAxiosInstance.post(CREATE_LIVE_SESSION_BULK, data, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
    });
    return response.data;
};

/**
 * Tuning for chunked creation:
 * - CHUNK_SIZE: rows per request.
 * - CONCURRENCY: how many requests run at once (bounded pool). The dominant cost
 *   is the backend's per-session creation time, which is sequential per request —
 *   so overlapping a few requests is what actually speeds up large batches. Higher
 *   concurrency = faster but more server load.
 * - RETRY_BACKOFF_MS: pause before the single retry of a failed chunk.
 */
export const BULK_CREATE_CHUNK_SIZE = 5;
export const BULK_CREATE_CONCURRENCY = 3;
export const BULK_CREATE_RETRY_BACKOFF_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Creates a large set of live sessions in chunks over a bounded concurrency pool
 * instead of one giant request, so the server isn't hit with everything at once
 * yet large batches still finish quickly. Each chunk reuses the existing
 * {@link createLiveSessionsBulk} endpoint; a failed chunk is retried once and (if
 * it still fails) only that chunk's rows are marked failed so the rest are still
 * created. Per-row `index`es are offset back to the original row order and results
 * are merged + sorted into one {@link BulkLiveSessionResponse} identical in shape
 * to the single-call path.
 */
export const createLiveSessionsChunked = async (
    sessions: LiveSessionStep1RequestDTO[],
    step2PerRow: LiveSessionStep2RequestDTO[],
    opts?: {
        chunkSize?: number;
        concurrency?: number;
        retryBackoffMs?: number;
        onProgress?: (done: number, total: number) => void;
    }
): Promise<BulkLiveSessionResponse> => {
    const chunkSize = opts?.chunkSize ?? BULK_CREATE_CHUNK_SIZE;
    const concurrency = Math.max(1, opts?.concurrency ?? BULK_CREATE_CONCURRENCY);
    const retryBackoffMs = opts?.retryBackoffMs ?? BULK_CREATE_RETRY_BACKOFF_MS;
    const total = sessions.length;

    // Chunk start offsets, processed by a bounded worker pool.
    const starts: number[] = [];
    for (let start = 0; start < total; start += chunkSize) starts.push(start);

    const results: BulkLiveSessionRowResult[] = [];
    let done = 0;
    opts?.onProgress?.(0, total);

    const runChunk = async (start: number): Promise<BulkLiveSessionRowResult[]> => {
        const chunkSessions = sessions.slice(start, start + chunkSize);
        const chunkStep2 = step2PerRow.slice(start, start + chunkSize);
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const resp = await createLiveSessionsBulk({
                    sessions: chunkSessions,
                    step2_per_row: chunkStep2,
                });
                // Offset each row index back to its position in the full list.
                return (resp.results ?? []).map((r) => ({ ...r, index: r.index + start }));
            } catch (err) {
                if (attempt === 0) {
                    await sleep(retryBackoffMs); // one quick retry
                    continue;
                }
                const message = err instanceof Error ? err.message : t('requestFailed');
                return chunkSessions.map((s, i) => ({
                    index: start + i,
                    success: false,
                    title: (s as { title?: string }).title,
                    error: message,
                    step2_applied: false,
                }));
            }
        }
        return [];
    };

    // Bounded pool: keep up to `concurrency` requests in flight. Each worker
    // pulls the next chunk offset from a shared cursor until they're exhausted.
    let cursor = 0;
    const worker = async () => {
        while (cursor < starts.length) {
            const start = starts[cursor++]!;
            const chunkResults = await runChunk(start);
            results.push(...chunkResults);
            done += chunkResults.length;
            opts?.onProgress?.(done, total);
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(concurrency, starts.length) }, () => worker())
    );

    // Workers finish out of order — sort so the results dialog lists rows in
    // their original sheet order.
    results.sort((a, b) => a.index - b.index);

    const total_created = results.filter((r) => r.success).length;
    return {
        total_requested: total,
        total_created,
        total_failed: total - total_created,
        results,
    };
};

export interface GetLiveSessionsRequest {
    instituteId?: string;
    session_id?: string;
    access_type?: string;
    package_session_ids?: string[];
    join_link?: string;
    notify_settings?: {
        notify_by: {
            mail: boolean;
            whatsapp: boolean;
        };
        on_create: boolean;
        on_live: boolean;
        before_live: boolean;
        before_live_time: Array<{
            time: string;
        }>;
    };
}

export interface PackageSessionDetail {
    package_session_id: string;
    package_name: string;
    level_name: string;
    session_name: string;
}

export interface LiveSession {
    session_id: string;
    schedule_id: string;
    meeting_date: string;
    start_time: string;
    last_entry_time: string;
    recurrence_type: string;
    access_level: string;
    title: string;
    subject: string;
    meeting_link: string;
    registration_form_link_for_public_sessions: string;
    allow_rewind?: boolean | null;
    allow_play_pause?: boolean | null;
    timezone?: string; // Changed from time_zone to timezone to match API response
    /** Streaming platform of this occurrence — see HostJoinTarget. */
    link_type?: string | null;
    /** Minutes before start that the waiting room opens; gates "Start as Host". */
    waiting_room_time?: number | null;
    default_class_link?: string | null;
    defaultClassName?: string | null;
    learner_button_config?: {
        text: string;
        url: string;
        background_color: string;
        text_color: string;
        visible: boolean;
    } | null;
    package_session_details?: PackageSessionDetail[] | null;
    instructors?: Array<{
        user_id: string;
        full_name?: string | null;
        email?: string | null;
        profile_pic_file_id?: string | null;
    }> | null;
}

export const createLiveSessionStep1 = async (data: LiveSessionStep1RequestDTO) => {
    const response = await authenticatedAxiosInstance.post(CREATE_LIVE_SESSION_STEP_1, data, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
    });
    return response.data;
};

/**
 * Creates the step-2 (participants/access/notifications) record for a session.
 * Defaults to {@link CREATE_LIVE_SESSION_STEP_2} (staging in dev) but can
 * accept a `urlOverride` so the bulk fan-out can target the same backend
 * the bulk endpoint hit (e.g. `localhost:8072`) — otherwise step 2 calls
 * would 404 against staging when the sessions live on a different server.
 */
export const createLiveSessionStep2 = async (
    data: LiveSessionStep2RequestDTO,
    urlOverride?: string
) => {
    const url = urlOverride ?? CREATE_LIVE_SESSION_STEP_2;
    const response = await authenticatedAxiosInstance.post(url, data, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
    });
    return response.data;
};

export interface CreateProviderMeetingParams {
    instituteId: string;
    sessionId: string;
    scheduleId: string;
    topic: string;
    agenda: string;
    startTime: string;
    durationMinutes: number;
    timezone: string;
    provider: string;
    /** Zoom only — which institute_zoom_account to create the meeting under. */
    zoomAccountId?: string;
    /** Zoom only — meeting settings (waitingRoom, muteUponEntry, joinBeforeHost, autoRecording). */
    zoomConfig?: Record<string, unknown>;
}

export const createProviderMeeting = async (data: CreateProviderMeetingParams) => {
    const response = await authenticatedAxiosInstance.post(CREATE_PROVIDER_MEETING, data, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
    });
    return response.data;
};

/**
 * Provisions a provider meeting for EVERY schedule of a session server-side, in one
 * call. The backend loops the session's not-yet-provisioned schedules (idempotent)
 * and derives each occurrence's start time + duration from its own row, so the admin
 * browser no longer loops a create call per occurrence. Used for recurring sessions.
 * Returns 202 immediately ({ status: 'PROCESSING', pendingCount }).
 */
export interface CreateProviderMeetingsForSessionParams {
    instituteId: string;
    sessionId: string;
    topic: string;
    agenda: string;
    /** Fallback duration if a schedule row has no start→last-entry window. */
    durationMinutes: number;
    timezone: string;
    provider: string;
    /** Vendor-neutral meeting settings (preferred). */
    providerConfig?: Record<string, unknown>;
    /** Vendor-neutral provider-account selector (preferred over zoomAccountId). */
    providerAccountId?: string;
    /** @deprecated Zoom legacy — use providerAccountId. Sent during transition. */
    zoomAccountId?: string;
    /** @deprecated Zoom legacy — use providerConfig. Sent during transition. */
    zoomConfig?: Record<string, unknown>;
}

export const createProviderMeetingsForSession = async (
    data: CreateProviderMeetingsForSessionParams
) => {
    const response = await authenticatedAxiosInstance.post(
        CREATE_PROVIDER_MEETINGS_FOR_SESSION,
        data,
        {
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
            },
        }
    );
    return response.data;
};

export interface ConflictingSession {
    meetingKey: string;
    topic: string;
    startTimeMillisec: number;
    endTimeMillisec: number;
}

export interface ProviderAvailabilityResult {
    available: boolean;
    conflicts?: ConflictingSession[];
}

/**
 * Double-booking check: returns other meetings already booked on the same provider
 * account that overlap any occurrence of this session. Advisory — the caller warns
 * the admin; it never blocks. Failures resolve to available=true so scheduling is
 * never gated on this call.
 */
export const checkProviderAvailabilityForSession = async (
    sessionId: string,
    providerAccountId: string
): Promise<ProviderAvailabilityResult> => {
    try {
        const response = await authenticatedAxiosInstance.get<ProviderAvailabilityResult>(
            PROVIDER_MEETING_AVAILABILITY_FOR_SESSION,
            { params: { sessionId, providerAccountId } }
        );
        return response.data ?? { available: true, conflicts: [] };
    } catch {
        return { available: true, conflicts: [] };
    }
};

export const getLiveSessions = async (instituteId: string) => {
    const response = await authenticatedAxiosInstance.get(GET_LIVE_SESSIONS, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
        params: {
            instituteId,
        },
    });
    return response.data;
};

export const deleteLiveSession = async (ids: string[], type: string, notifyStudents?: boolean) => {
    try {
        const body: { ids: string[]; type: string; notifyStudents?: boolean } = { ids, type };
        if (notifyStudents !== undefined) {
            body.notifyStudents = notifyStudents;
        }
        const response = await authenticatedAxiosInstance.post(DELETE_LIVE_SESSION, body, {
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error deleting live session:', error);
        throw error;
    }
};
