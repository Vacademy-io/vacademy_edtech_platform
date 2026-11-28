import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getLmsVideoStatus,
    isTerminalLmsVideoStatus,
    type LmsVideoStatus,
} from '@/services/lms-ai-video';

export const LMS_VIDEO_POLL_MS = 10_000;

/**
 * checking  — the first /lms-video/v1/status call is in flight
 * legacy    — not an LMS video (404) or the endpoint is unavailable: keep the
 *             old /video/urls behaviour untouched
 * running   — still generating; polled every 10 s
 * completed — done; the regular player takes over
 * ended     — FAILED or CANCELLED (credits refunded by the server)
 */
export type LmsVideoPhase = 'checking' | 'legacy' | 'running' | 'completed' | 'ended';

export const phaseForStatus = (status: string | null | undefined): LmsVideoPhase => {
    const value = (status || '').toUpperCase();
    if (value === 'COMPLETED') return 'completed';
    if (isTerminalLmsVideoStatus(value)) return 'ended';
    return 'running';
};

/**
 * Live status of an AI video created from the LMS. Polls while the run is in
 * progress and stops on a terminal status, on unmount, or when the id changes.
 * Pass undefined to do nothing (non-AI slides) — the phase is then 'legacy'.
 */
export function useLmsVideoStatus(videoId: string | null | undefined) {
    const [phase, setPhase] = useState<LmsVideoPhase>(videoId ? 'checking' : 'legacy');
    const [status, setStatus] = useState<LmsVideoStatus | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    /** The video id that has answered at least once — later failures are blips, not "not LMS". */
    const answeredFor = useRef<string | null>(null);
    // Bumped to re-run the poll loop immediately (e.g. right after a cancel).
    const [tick, setTick] = useState(0);

    useEffect(() => {
        setStatus(null);
        setPhase(videoId ? 'checking' : 'legacy');
    }, [videoId]);

    useEffect(() => {
        if (!videoId) return undefined;
        let alive = true;

        const clearTimer = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = null;
        };

        const poll = async () => {
            clearTimer();
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            try {
                const next = await getLmsVideoStatus(videoId, controller.signal);
                if (!alive) return;
                answeredFor.current = videoId;
                const nextPhase = phaseForStatus(next.status);
                setStatus(next);
                setPhase(nextPhase);
                if (nextPhase === 'running') {
                    timerRef.current = setTimeout(poll, LMS_VIDEO_POLL_MS);
                }
            } catch (error) {
                if (!alive || controller.signal.aborted) return;
                const code = (error as { response?: { status?: number } })?.response?.status;
                if (answeredFor.current !== videoId || code === 404) {
                    // Not an LMS video (or this backend has no /lms-video yet).
                    setPhase('legacy');
                    return;
                }
                // A blip mid-run: keep the last status on screen and try again.
                timerRef.current = setTimeout(poll, LMS_VIDEO_POLL_MS);
            }
        };

        void poll();
        return () => {
            alive = false;
            clearTimer();
            controllerRef.current?.abort();
        };
    }, [videoId, tick]);

    const refresh = useCallback(() => setTick((n) => n + 1), []);

    return { phase, status, refresh };
}
