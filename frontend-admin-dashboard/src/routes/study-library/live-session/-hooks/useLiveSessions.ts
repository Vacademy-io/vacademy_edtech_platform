import { useQuery } from '@tanstack/react-query';
import {
    getLiveSessions,
    getUpcomingSessions,
    getPastSessions,
    getDraftSessions,
    getSessionBySessionId,
    LiveSession,
    UpcomingSessionDay,
    PastSessionDay,
    DraftSessionDay,
    SessionBySessionIdResponse,
    searchSessions,
    SessionSearchRequest,
    SessionSearchResponse,
} from '../-services/utils';

export function useLiveSessions(instituteId: string) {
    return useQuery<LiveSession[], Error>({
        queryKey: ['liveSessions', instituteId],
        queryFn: () => getLiveSessions(instituteId),
        staleTime: 0, // Always consider data stale so it refetches on mount
    });
}

/**
 * `options` lets a screen with several readers of the same list (the dashboard's KPI band and
 * Live Classes widget) share one request: with the default staleTime of 0, every reader that
 * mounts later refetches. Pages that want always-fresh data keep calling it without options.
 */
export function useUpcomingSessions(
    instituteId: string,
    options?: { staleTime?: number; enabled?: boolean }
) {
    return useQuery<UpcomingSessionDay[], Error>({
        queryKey: ['upcomingSessions', instituteId],
        queryFn: () => getUpcomingSessions(instituteId),
        staleTime: options?.staleTime ?? 0,
        enabled: options?.enabled ?? true,
    });
}

export function usePastSessions(instituteId: string) {
    return useQuery<PastSessionDay[], Error>({
        queryKey: ['pastSessions', instituteId],
        queryFn: () => getPastSessions(instituteId),
        staleTime: 0,
    });
}

export function useDraftSessions(instituteId: string) {
    return useQuery<DraftSessionDay[], Error>({
        queryKey: ['draftSessions', instituteId],
        queryFn: () => getDraftSessions(instituteId),
        staleTime: 0,
    });
}

export function useSessionBySessionId(sessionId: string) {
    return useQuery<SessionBySessionIdResponse, Error>({
        queryKey: ['sessionBySessionId', sessionId],
        queryFn: () => getSessionBySessionId(sessionId),
        enabled: !!sessionId,
        staleTime: 5 * 60 * 1000,
    });
}

export function useSessionSearch(request: SessionSearchRequest) {
    return useQuery<SessionSearchResponse, Error>({
        queryKey: ['sessionSearch', request],
        queryFn: () => searchSessions(request),
        staleTime: 0,
    });
}
