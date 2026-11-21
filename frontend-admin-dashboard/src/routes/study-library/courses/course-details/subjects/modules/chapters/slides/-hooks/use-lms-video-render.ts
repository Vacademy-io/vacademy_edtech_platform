import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
    getLmsVideoRender,
    parseLmsVideoError,
    startLmsVideoRender,
    type LmsVideoApiError,
} from '@/services/lms-ai-video';
import {
    initialRenderBarState,
    renderBarMode,
    renderBarReducer,
    shouldPollRender,
} from '@/services/lms-ai-video-render';

export const LMS_VIDEO_RENDER_POLL_MS = 5_000;

const httpStatus = (error: unknown): number | undefined =>
    (error as { response?: { status?: number } })?.response?.status;

/**
 * MP4 render of a finished LMS AI video. Reads the current render once on
 * mount (404 → hidden: not an LMS video), polls every 5 s while a render is
 * queued or running, and stops on a terminal state, on unmount, or when the
 * id changes. Pass undefined to do nothing.
 */
export function useLmsVideoRender(videoId: string | null | undefined) {
    const [state, dispatch] = useReducer(renderBarReducer, initialRenderBarState);
    // The id the latest POST belongs to — a reply for an older slide is dropped.
    const currentIdRef = useRef(videoId);
    currentIdRef.current = videoId;

    // One read on mount / when the slide changes, to show an existing MP4.
    useEffect(() => {
        dispatch({ type: 'reset' });
        if (!videoId) return undefined;
        const controller = new AbortController();
        getLmsVideoRender(videoId, controller.signal)
            .then((render) => dispatch({ type: 'loaded', render }))
            .catch((error) => {
                if (controller.signal.aborted) return;
                dispatch({ type: httpStatus(error) === 404 ? 'not_found' : 'load_failed' });
            });
        return () => controller.abort();
    }, [videoId]);

    const polling = shouldPollRender(state);

    useEffect(() => {
        if (!videoId || !polling) return undefined;
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let controller: AbortController | null = null;

        const tick = async () => {
            controller = new AbortController();
            try {
                const render = await getLmsVideoRender(videoId, controller.signal);
                if (!alive) return;
                // A terminal state flips `polling` off and this effect's cleanup
                // clears the timer scheduled below.
                dispatch({ type: 'polled', render });
            } catch (error) {
                if (!alive || controller.signal.aborted) return;
                if (httpStatus(error) === 404) {
                    dispatch({ type: 'not_found' });
                    return;
                }
                // A blip: keep the last state on screen and try again.
            }
            if (alive) timer = setTimeout(tick, LMS_VIDEO_RENDER_POLL_MS);
        };

        timer = setTimeout(tick, LMS_VIDEO_RENDER_POLL_MS);
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
            controller?.abort();
        };
    }, [videoId, polling]);

    /** Start (or re-read) the render. Resolves to the error to show, or null. */
    const start = useCallback(
        async (fallback: string): Promise<LmsVideoApiError | null> => {
            if (!videoId) return null;
            dispatch({ type: 'start' });
            try {
                const render = await startLmsVideoRender(videoId);
                if (currentIdRef.current === videoId) dispatch({ type: 'started', render });
                return null;
            } catch (error) {
                if (currentIdRef.current === videoId) dispatch({ type: 'start_failed' });
                return parseLmsVideoError(error, fallback);
            }
        },
        [videoId]
    );

    return { mode: renderBarMode(state), render: state.render, start };
}
