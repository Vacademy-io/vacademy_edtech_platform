import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    LIVE_ACTIVITY_COUNTS,
    LIVE_ACTIVITY_ANALYTICS,
    LIVE_ACTIVITY_EVENTS,
    LIVE_ACTIVITY_MARK_SEEN,
    LIVE_ACTIVITY_STREAM_TOKEN,
    LIVE_ACTIVITY_UNSEEN_COUNT,
} from '@/constants/urls';

export type LiveActivityCategory = 'INVITE_FORM' | 'LEAD_FORM' | 'CALL' | 'PAYMENT' | 'COUNSELLOR';

export type LiveActivityActorType =
    | 'PROSPECT'
    | 'LEARNER'
    | 'COUNSELLOR'
    | 'ADMIN'
    | 'AI'
    | 'SYSTEM';

/**
 * One event. Shape matches both the SSE frame and a row of GET /events, deliberately --
 * the feed merges a live frame and a backfilled row into the same list, so a single type
 * keeps them from drifting.
 */
export interface LiveActivityEvent {
    eventId: string;
    instituteId: string;
    occurredAtEpochMillis: number;
    category: LiveActivityCategory;
    action: string;
    actorType: LiveActivityActorType;
    subjectName?: string;
    subjectEmail?: string;
    subjectMobile?: string;
    subjectId?: string;
    entityId?: string;
    counsellorUserId?: string;
    counsellorName?: string;
    payload?: Record<string, unknown>;
}

export interface LiveActivityPage {
    content: LiveActivityEvent[];
    totalElements: number;
    totalPages: number;
    number: number;
}

export interface StreamTokenResponse {
    token: string;
    expiresAtEpochMillis: number;
    /**
     * Echoed for rendering only. The server independently filters every frame against the
     * same set, so trusting this client-side would not widen access even if it were tampered
     * with -- it only decides which tabs are drawn.
     */
    allowedCategories: LiveActivityCategory[];
}

export interface LiveActivityFilters {
    categories?: LiveActivityCategory[];
    from?: number;
    to?: number;
    counsellorUserId?: string;
    page?: number;
    size?: number;
}

/** Filter arrays travel as ONE comma-separated param: the ingress 400s on `foo[]=` syntax. */
const joinCategories = (categories?: LiveActivityCategory[]): string | undefined =>
    categories && categories.length > 0 ? categories.join(',') : undefined;

export const fetchStreamToken = async (instituteId: string): Promise<StreamTokenResponse> => {
    const response = await authenticatedAxiosInstance.post(LIVE_ACTIVITY_STREAM_TOKEN(instituteId));
    return response.data;
};

export const fetchLiveActivityEvents = async (
    instituteId: string,
    filters: LiveActivityFilters
): Promise<LiveActivityPage> => {
    const response = await authenticatedAxiosInstance.get(LIVE_ACTIVITY_EVENTS, {
        params: {
            instituteId,
            categories: joinCategories(filters.categories),
            from: filters.from,
            to: filters.to,
            counsellorUserId: filters.counsellorUserId,
            page: filters.page ?? 0,
            size: filters.size ?? 100,
        },
    });
    return response.data;
};

export const fetchLiveActivityCounts = async (
    instituteId: string,
    since: number
): Promise<Record<string, number>> => {
    const response = await authenticatedAxiosInstance.get(LIVE_ACTIVITY_COUNTS, {
        params: { instituteId, since },
    });
    return response.data;
};

export const fetchUnseenCount = async (instituteId: string): Promise<number> => {
    const response = await authenticatedAxiosInstance.get(LIVE_ACTIVITY_UNSEEN_COUNT, {
        params: { instituteId },
    });
    return response.data;
};

export const markLiveActivitySeen = async (instituteId: string): Promise<void> => {
    await authenticatedAxiosInstance.post(LIVE_ACTIVITY_MARK_SEEN, null, {
        params: { instituteId },
    });
};

/**
 * Backfill. Loaded before the stream attaches so an opening page is never blank, and so a
 * reconnect can resume without assuming continuity.
 */
export const useLiveActivityBackfill = (instituteId: string, filters: LiveActivityFilters) =>
    useQuery({
        queryKey: ['live-activity', 'backfill', instituteId, filters],
        queryFn: () => fetchLiveActivityEvents(instituteId, filters),
        enabled: !!instituteId,
        // No refetchInterval on purpose. This is a push feed; polling it would be the
        // pulse-style behaviour this feature exists to avoid.
        refetchOnWindowFocus: false,
    });

export const useLiveActivityCounts = (instituteId: string, since: number) =>
    useQuery({
        queryKey: ['live-activity', 'counts', instituteId, since],
        queryFn: () => fetchLiveActivityCounts(instituteId, since),
        enabled: !!instituteId,
        refetchOnWindowFocus: false,
    });

// ── Analytics dashboard ──

export interface NamedCount {
    name: string;
    count: number;
}

export interface TimeBucket {
    startEpochMillis: number;
    count: number;
}

export interface LiveActivityAnalytics {
    kpis: {
        leads: number;
        enrolments: number;
        revenue: number;
        currency?: string;
        callsPlaced: number;
        callsConnected: number;
        needsAttention: number;
        previousLeads: number;
        previousEnrolments: number;
        previousRevenue: number;
    };
    funnel: NamedCount[];
    timeline: TimeBucket[];
    leadSources: NamedCount[];
    counsellors: NamedCount[];
    callOutcomes: NamedCount[];
}

export const fetchLiveActivityAnalytics = async (
    instituteId: string,
    from: number,
    to: number
): Promise<LiveActivityAnalytics> => {
    const response = await authenticatedAxiosInstance.get(LIVE_ACTIVITY_ANALYTICS, {
        params: { instituteId, from, to },
    });
    return response.data;
};

/**
 * One query for the whole dashboard.
 *
 * refetchInterval is deliberately absent: the numbers move when the stream delivers an
 * event, so the page invalidates this itself rather than polling on a timer.
 */
export const useLiveActivityAnalytics = (instituteId: string, from: number, to: number) =>
    useQuery({
        queryKey: ['live-activity', 'analytics', instituteId, from, to],
        queryFn: () => fetchLiveActivityAnalytics(instituteId, from, to),
        enabled: !!instituteId,
        refetchOnWindowFocus: false,
    });
