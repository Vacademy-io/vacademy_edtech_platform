import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
    getVideoStatus,
    type ContentType,
    type VideoOrientation,
    type VideoStatusResponse,
} from '../../../-services/video-generation';
import { derivePipelineFromStatus, type PipelineState } from './derive-pipeline-state';
import { readPollingPriority, usePollingPriorityValue } from './use-polling-priority';

/**
 * Canonical pipeline-state hook. Wraps a React Query poll of `/status` with
 * adaptive cadence (5s when any consumer wants fast polling, 15s otherwise,
 * paused when the tab is hidden or the run reaches a terminal status) and
 * returns the derived `PipelineState` ready for consumption by
 * PipelineFlow / PipelinePanel / NodeDetailSheet.
 *
 * SSE invalidation is intentionally NOT subscribed to inside this hook —
 * the active SSE stream is managed by `VideoConsoleWorkspace` and forwards
 * invalidations into the React Query cache via the standard
 * `queryClient.invalidateQueries(getVideoStatusQueryKey(videoId))` pattern.
 * Keeping the SSE concern out of this hook makes it equally usable for
 * history-restored runs (no SSE) and live runs (SSE-driven invalidations).
 */
export interface UseVideoStateOptions {
    /**
     * Hard kill-switch — when `true`, the underlying query is disabled. Use
     * for "user navigated away" / "operation aborted, polling should stop"
     * scenarios. Polling also auto-stops on terminal `/status.status`, so
     * pass `disabled` only when you need to override even that.
     */
    disabled?: boolean;
    /**
     * Pin a startedAt timestamp into the derived `stats.elapsedMs`. Caller
     * captures `Date.now()` at submit and threads it through so derivation
     * stays pure (and refresh-safe — read from localStorage on remount).
     */
    startedAtMs?: number;
    /** Fallback prompt when the BE status response omits it. */
    promptOverride?: string;
    /** Fallback content_type. */
    contentTypeOverride?: ContentType;
    /** Fallback orientation. */
    orientationOverride?: VideoOrientation;
}

/**
 * Shared query key. Exported so SSE event handlers can invalidate from
 * anywhere via `queryClient.invalidateQueries(getVideoStatusQueryKey(id))`.
 * `apiKey` participates in the key so a key rotation forces a fresh fetch.
 */
export function getVideoStatusQueryKey(
    videoId: string | undefined,
    apiKey: string | undefined
): QueryKey {
    return ['video-status', videoId, apiKey];
}

const FAST_INTERVAL_MS = 5_000;
const SLOW_INTERVAL_MS = 15_000;

/** Statuses where there's nothing more to poll for. */
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'STALLED', 'CANCELLED']);

/**
 * Returns the derived `PipelineState` + the React Query meta. Note:
 * `pipelineState` is `null` only on the very first render before the
 * initial fetch resolves; once data lands, it stays populated even across
 * refetches (React Query holds the previous data while revalidating).
 */
export function useVideoState(
    videoId: string | undefined,
    apiKey: string | undefined,
    opts?: UseVideoStateOptions
): {
    pipelineState: PipelineState | null;
    status: VideoStatusResponse | undefined;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => void;
} {
    // Subscribe to priority changes so the hook re-renders when cadence
    // flips — without this, React Query's `refetchInterval` callback still
    // reads the latest priority via `readPollingPriority()`, but the
    // component using the hook wouldn't trigger a re-render to pick up a
    // new interval until the next natural refetch.
    usePollingPriorityValue();

    // Bound to the derivation namespace — `derivePipelineFromStatus` renders
    // its "X cut from production" node errors through this `t`.
    const { t } = useTranslation('videoApiStudioDerivePipelineState');

    const queryClient = useQueryClient();

    const query = useQuery<VideoStatusResponse>({
        // Inline rather than memoized — TanStack's exhaustive-deps lint
        // wants to see the raw key dependencies syntactically. The shared
        // helper `getVideoStatusQueryKey()` is exported for invalidation
        // callers outside this hook.
        queryKey: ['video-status', videoId, apiKey],
        queryFn: () => {
            if (!videoId || !apiKey) throw new Error('missing videoId or apiKey');
            return getVideoStatus(videoId, apiKey);
        },
        enabled: !!videoId && !!apiKey && !opts?.disabled,
        // Always treat the cached data as stale — fresh polls are cheap and
        // the BE record changes continuously during generation. React Query
        // still serves the cached value while refetching, so consumers
        // never see a `null` flash.
        staleTime: 0,
        // Adaptive cadence. Returns `false` (no refetch) on terminal status
        // so completed / failed / cancelled videos don't keep polling
        // forever. Live runs alternate between fast (5s) and slow (15s)
        // based on the shared polling priority counter.
        refetchInterval: (q) => {
            const last = q.state.data as VideoStatusResponse | undefined;
            if (last && TERMINAL_STATUSES.has(last.status)) return false;
            return readPollingPriority() === 'fast' ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
        },
        // Default `refetchIntervalInBackground: false` already pauses the
        // poll when the tab is hidden — explicit for clarity.
        refetchIntervalInBackground: false,
        retry: 1,
        refetchOnWindowFocus: false,
    });

    const pipelineState = useMemo<PipelineState | null>(() => {
        if (!query.data) return null;
        return derivePipelineFromStatus(
            query.data,
            {
                startedAtMs: opts?.startedAtMs,
                promptOverride: opts?.promptOverride,
                contentTypeOverride: opts?.contentTypeOverride,
                orientationOverride: opts?.orientationOverride,
            },
            undefined,
            t
        );
    }, [
        query.data,
        opts?.startedAtMs,
        opts?.promptOverride,
        opts?.contentTypeOverride,
        opts?.orientationOverride,
        t,
    ]);

    return {
        pipelineState,
        status: query.data,
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error as Error | null,
        refetch: () => {
            // Cancel any in-flight poll first so its stale result can't
            // overwrite the fresh response. Guards against the "5s poll
            // started, then SSE event fires + invalidates" race that would
            // otherwise let the stale-but-still-resolving poll clobber the
            // fresh data.
            const key = getVideoStatusQueryKey(videoId, apiKey);
            queryClient.cancelQueries({ queryKey: key });
            queryClient.invalidateQueries({ queryKey: key });
        },
    };
}
