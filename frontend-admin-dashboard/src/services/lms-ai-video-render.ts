/**
 * State of the "Render MP4" bar on a finished AI-video slide — a pure reducer
 * so the polling rules can be tested without React or the network.
 *
 * Life cycle: one GET on mount (checking) → hidden when the server says 404
 * (not an LMS video) or shown otherwise. While shown, a POST moves it to
 * starting, and a queued/running render is polled until it completes or fails.
 */
import { isActiveLmsVideoRender, type LmsVideoRenderState } from './lms-ai-video';

export interface RenderBarState {
    /** checking = the first GET is in flight; hidden = not an LMS video (404). */
    visibility: 'checking' | 'hidden' | 'shown';
    /** null = unknown (the first GET failed for another reason) or never rendered. */
    render: LmsVideoRenderState | null;
    /** A POST /render is in flight. */
    starting: boolean;
}

export type RenderBarAction =
    | { type: 'reset' }
    | { type: 'loaded'; render: LmsVideoRenderState }
    /** GET answered 404: this video isn't an LMS video — hide the bar for good. */
    | { type: 'not_found' }
    /** GET failed for another reason: still offer "Render MP4". */
    | { type: 'load_failed' }
    | { type: 'start' }
    | { type: 'started'; render: LmsVideoRenderState }
    | { type: 'start_failed' }
    | { type: 'polled'; render: LmsVideoRenderState };

export const initialRenderBarState: RenderBarState = {
    visibility: 'checking',
    render: null,
    starting: false,
};

export function renderBarReducer(state: RenderBarState, action: RenderBarAction): RenderBarState {
    switch (action.type) {
        case 'reset':
            return initialRenderBarState;
        case 'loaded':
            return { visibility: 'shown', render: action.render, starting: false };
        case 'not_found':
            return { visibility: 'hidden', render: null, starting: false };
        case 'load_failed':
            return state.visibility === 'checking'
                ? { visibility: 'shown', render: null, starting: false }
                : state;
        case 'start':
            return state.visibility === 'hidden' ? state : { ...state, starting: true };
        case 'started':
            return state.visibility === 'hidden'
                ? state
                : { visibility: 'shown', render: action.render, starting: false };
        case 'start_failed':
            return { ...state, starting: false };
        case 'polled':
            // A poll that lands after the bar was hidden (or reset) is stale.
            return state.visibility === 'shown' ? { ...state, render: action.render } : state;
        default:
            return state;
    }
}

export type RenderBarMode =
    | 'hidden'
    | 'idle'
    | 'starting'
    | 'queued'
    | 'running'
    | 'ready'
    | 'failed';

/** What the bar should show. "checking" renders nothing to avoid a flash. */
export function renderBarMode(state: RenderBarState): RenderBarMode {
    if (state.visibility !== 'shown') return 'hidden';
    if (state.starting) return 'starting';
    const render = state.render;
    if (!render) return 'idle';
    switch (render.status) {
        case 'queued':
            return 'queued';
        case 'running':
            return 'running';
        case 'completed':
            // A completed render without a file can only be rendered again.
            return render.video_url ? 'ready' : 'idle';
        case 'failed':
            return 'failed';
        default:
            return 'idle';
    }
}

/** Poll only a visible, queued or running render (not while a POST is in flight). */
export const shouldPollRender = (state: RenderBarState): boolean =>
    state.visibility === 'shown' && !state.starting && isActiveLmsVideoRender(state.render);
