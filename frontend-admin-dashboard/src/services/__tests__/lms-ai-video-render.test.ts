import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    getLmsVideoRender,
    isActiveLmsVideoRender,
    normalizeLmsVideoRenderState,
    startLmsVideoRender,
    type LmsVideoRenderState,
} from '../lms-ai-video';
import {
    initialRenderBarState,
    renderBarMode,
    renderBarReducer,
    shouldPollRender,
    type RenderBarAction,
    type RenderBarState,
} from '../lms-ai-video-render';

const render = (overrides: Partial<LmsVideoRenderState> = {}): LmsVideoRenderState => ({
    status: 'none',
    progress: 0,
    video_url: null,
    error: null,
    updated_at: null,
    ...overrides,
});

const run = (actions: RenderBarAction[], from: RenderBarState = initialRenderBarState) =>
    actions.reduce(renderBarReducer, from);

describe('normalizeLmsVideoRenderState', () => {
    it('keeps a well-formed state', () => {
        expect(
            normalizeLmsVideoRenderState({
                status: 'running',
                progress: 42.4,
                video_url: null,
                error: null,
                updated_at: '2026-10-13T10:00:00Z',
            })
        ).toEqual(render({ status: 'running', progress: 42, updated_at: '2026-10-13T10:00:00Z' }));
    });

    it('reads an unknown status as "none" and clamps progress', () => {
        expect(normalizeLmsVideoRenderState({ status: 'weird', progress: 250 })).toEqual(
            render({ status: 'none', progress: 100 })
        );
        expect(normalizeLmsVideoRenderState({ status: 'QUEUED', progress: -3 }).status).toBe(
            'queued'
        );
        expect(normalizeLmsVideoRenderState({ status: 'queued', progress: -3 }).progress).toBe(0);
        expect(normalizeLmsVideoRenderState(null)).toEqual(render());
    });

    it('reports 100 % for a completed render and drops blank strings', () => {
        expect(
            normalizeLmsVideoRenderState({
                status: 'completed',
                progress: 97,
                video_url: 'https://s3/x.mp4',
                error: '  ',
            })
        ).toEqual(render({ status: 'completed', progress: 100, video_url: 'https://s3/x.mp4' }));
    });

    it('drops a video_url that is not http(s)', () => {
        expect(
            normalizeLmsVideoRenderState({ status: 'completed', video_url: 'javascript:alert(1)' })
                .video_url
        ).toBeNull();
        expect(
            normalizeLmsVideoRenderState({ status: 'completed', video_url: 'HTTPS://s3/x.mp4' })
                .video_url
        ).toBe('HTTPS://s3/x.mp4');
    });

    it('treats only queued and running as active', () => {
        expect(isActiveLmsVideoRender(render({ status: 'queued' }))).toBe(true);
        expect(isActiveLmsVideoRender(render({ status: 'running' }))).toBe(true);
        expect(isActiveLmsVideoRender(render({ status: 'completed' }))).toBe(false);
        expect(isActiveLmsVideoRender(render({ status: 'failed' }))).toBe(false);
        expect(isActiveLmsVideoRender(null)).toBe(false);
    });
});

describe('render calls', () => {
    it('GET and POST hit /lms-video/v1/render/{id} and normalise the reply', async () => {
        vi.mocked(authenticatedAxiosInstance.get).mockResolvedValueOnce({
            data: { status: 'running', progress: 10 },
        });
        vi.mocked(authenticatedAxiosInstance.post).mockResolvedValueOnce({
            data: { status: 'queued', progress: 0 },
        });

        expect((await getLmsVideoRender('v 1')).status).toBe('running');
        expect(vi.mocked(authenticatedAxiosInstance.get).mock.calls[0]?.[0]).toMatch(
            /\/lms-video\/v1\/render\/v%201$/
        );

        expect((await startLmsVideoRender('v1', { resolution: '720p' })).status).toBe('queued');
        const [url, body] = vi.mocked(authenticatedAxiosInstance.post).mock.calls[0] ?? [];
        expect(url).toMatch(/\/lms-video\/v1\/render\/v1$/);
        expect(body).toEqual({ resolution: '720p' });
    });
});

describe('renderBarReducer', () => {
    it('stays hidden (renders nothing) while the first read is in flight', () => {
        expect(renderBarMode(initialRenderBarState)).toBe('hidden');
        expect(shouldPollRender(initialRenderBarState)).toBe(false);
    });

    it('hides the bar for a video the API does not know (404)', () => {
        const state = run([{ type: 'not_found' }]);
        expect(renderBarMode(state)).toBe('hidden');
        // A late POST or poll can't bring it back.
        expect(renderBarMode(run([{ type: 'start' }], state))).toBe('hidden');
        expect(renderBarMode(run([{ type: 'polled', render: render() }], state))).toBe('hidden');
        expect(
            renderBarMode(run([{ type: 'started', render: render({ status: 'queued' }) }], state))
        ).toBe('hidden');
    });

    it('offers "Render MP4" when never rendered or when the first read failed', () => {
        expect(renderBarMode(run([{ type: 'loaded', render: render() }]))).toBe('idle');
        expect(renderBarMode(run([{ type: 'load_failed' }]))).toBe('idle');
    });

    it('shows an existing MP4 straight away', () => {
        const state = run([
            {
                type: 'loaded',
                render: render({
                    status: 'completed',
                    progress: 100,
                    video_url: 'https://s3/x.mp4',
                }),
            },
        ]);
        expect(renderBarMode(state)).toBe('ready');
        expect(shouldPollRender(state)).toBe(false);
    });

    it('a completed render without a file can be rendered again', () => {
        const state = run([{ type: 'loaded', render: render({ status: 'completed' }) }]);
        expect(renderBarMode(state)).toBe('idle');
    });

    it('polls an in-progress render found on mount', () => {
        const state = run([
            { type: 'loaded', render: render({ status: 'running', progress: 30 }) },
        ]);
        expect(renderBarMode(state)).toBe('running');
        expect(shouldPollRender(state)).toBe(true);
    });

    it('start → queued → running → completed, polling only while active', () => {
        let state = run([{ type: 'loaded', render: render() }, { type: 'start' }]);
        expect(renderBarMode(state)).toBe('starting');
        expect(shouldPollRender(state)).toBe(false);

        state = run([{ type: 'started', render: render({ status: 'queued' }) }], state);
        expect(renderBarMode(state)).toBe('queued');
        expect(shouldPollRender(state)).toBe(true);

        state = run(
            [{ type: 'polled', render: render({ status: 'running', progress: 55 }) }],
            state
        );
        expect(renderBarMode(state)).toBe('running');
        expect(state.render?.progress).toBe(55);
        expect(shouldPollRender(state)).toBe(true);

        state = run(
            [
                {
                    type: 'polled',
                    render: render({
                        status: 'completed',
                        progress: 100,
                        video_url: 'https://s3/x.mp4',
                    }),
                },
            ],
            state
        );
        expect(renderBarMode(state)).toBe('ready');
        expect(shouldPollRender(state)).toBe(false);
    });

    it('a failed render stops polling and offers "Try again"', () => {
        let state = run([
            { type: 'loaded', render: render({ status: 'running' }) },
            { type: 'polled', render: render({ status: 'failed', error: 'worker crashed' }) },
        ]);
        expect(renderBarMode(state)).toBe('failed');
        expect(shouldPollRender(state)).toBe(false);

        state = run([{ type: 'start' }, { type: 'start_failed' }], state);
        // A rejected POST leaves the previous state on screen.
        expect(renderBarMode(state)).toBe('failed');
        expect(state.render?.error).toBe('worker crashed');
    });

    it('reset returns to the initial checking state', () => {
        const state = run([
            { type: 'loaded', render: render({ status: 'running' }) },
            { type: 'reset' },
        ]);
        expect(state).toEqual(initialRenderBarState);
    });
});
