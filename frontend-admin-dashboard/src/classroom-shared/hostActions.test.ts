import { describe, expect, it, vi } from 'vitest';
import { createHostActions, detectHostProvider, type HostHttpGet } from './hostActions';

const ok = (data: unknown) => Promise.resolve({ status: 200, data });

function setup(http: HostHttpGet) {
    const wait = vi.fn(() => Promise.resolve());
    const onProgress = vi.fn();
    return { wait, onProgress, actions: createHostActions(http, { wait, onProgress }) };
}

describe('detectHostProvider', () => {
    it('reads link_type, then streaming_type, case and space insensitive', () => {
        expect(detectHostProvider('BBB', null)).toBe('bbb');
        expect(detectHostProvider('other', ' zoom ')).toBe('zoom');
        expect(detectHostProvider(null, 'Google Meet')).toBe('meet');
        expect(detectHostProvider('GMEET', null)).toBe('meet');
        expect(detectHostProvider('zoho_meeting', 'embed')).toBe('zoho');
        expect(detectHostProvider('zoom', 'bbb')).toBe('zoom');
        expect(detectHostProvider('youtube', 'embed')).toBeNull();
    });
});

describe('startBbb', () => {
    it('asks as moderator and returns the join URL', async () => {
        const http = vi.fn(() => ok({ joinUrl: ' https://bbb.test/join ' }));
        const result = await setup(http).actions.startBbb('s1');
        expect(http).toHaveBeenCalledWith(
            '/admin-core-service/live-sessions/provider/meeting/join',
            { scheduleId: 's1', role: 'MODERATOR', recreate: false }
        );
        expect(result).toEqual({ kind: 'open-url', provider: 'bbb', url: 'https://bbb.test/join' });
    });

    it('returns MEETING_ENDED for the caller to confirm, then recreate works', async () => {
        const http = vi.fn<Parameters<HostHttpGet>, ReturnType<HostHttpGet>>((_, params) =>
            ok(params.recreate ? { joinUrl: 'https://bbb.test/new' } : { status: 'MEETING_ENDED' })
        );
        const { actions } = setup(http);
        expect(await actions.startBbb('s1')).toEqual({
            kind: 'meeting-ended',
            provider: 'bbb',
            scheduleId: 's1',
        });
        expect(http).toHaveBeenCalledTimes(1);
        expect(await actions.startBbb('s1', true)).toMatchObject({ url: 'https://bbb.test/new' });
    });

    it('returns RECREATE_BLOCKED with the server message', async () => {
        const http = vi.fn(() => ok({ status: 'RECREATE_BLOCKED', message: 'Still in use' }));
        expect(await setup(http).actions.startBbb('s1', true)).toEqual({
            kind: 'recreate-blocked',
            provider: 'bbb',
            message: 'Still in use',
        });
    });

    it('refuses a URL that is not http(s)', async () => {
        const http = vi.fn(() => ok({ joinUrl: 'javascript:alert(1)' }));
        expect((await setup(http).actions.startBbb('s1')).kind).toBe('no-url');
    });

    it('reports a failure with its status, null when the network failed', async () => {
        const axiosStyle = vi.fn(() => Promise.reject({ response: { status: 403 } }));
        expect(await setup(axiosStyle).actions.startBbb('s1')).toEqual({
            kind: 'failed',
            provider: 'bbb',
            status: 403,
        });
        const network = vi.fn(() => Promise.reject(new Error('offline')));
        expect(await setup(network).actions.startBbb('s1')).toEqual({
            kind: 'failed',
            provider: 'bbb',
            status: null,
        });
    });
});

describe('startZoom', () => {
    it('returns the host route with no HTTP call, so the one-shot signature is left alone', () => {
        const http = vi.fn(() => ok({}));
        expect(setup(http).actions.startZoom('sess 1', 'sched/1')).toEqual({
            kind: 'open-route',
            provider: 'zoom',
            path: '/study-library/live-session/host/sched%2F1?sessionId=sess%201',
        });
        expect(http).not.toHaveBeenCalled();
    });
});

describe('startMeet', () => {
    it('waits 5 s when a co-host was just added', async () => {
        const http = vi.fn(() =>
            ok({
                joinUrl: 'https://meet.test/x',
                cohostJustAdded: true,
                cohostEmail: 't@test',
                organizerEmail: 'o@test',
            })
        );
        const { actions, wait, onProgress } = setup(http);
        expect(await actions.startMeet('s1')).toEqual({
            kind: 'open-url',
            provider: 'meet',
            url: 'https://meet.test/x',
            cohostEmail: 't@test',
            organizerEmail: 'o@test',
        });
        expect(wait).toHaveBeenCalledWith(5000);
        expect(onProgress).toHaveBeenCalledWith('COHOST_SETTLING');
    });

    it('does not wait without a new co-host', async () => {
        const http = vi.fn(() => ok({ joinUrl: 'https://meet.test/x' }));
        const { actions, wait } = setup(http);
        await actions.startMeet('s1');
        expect(wait).not.toHaveBeenCalled();
    });

    it('retries a 409, whether thrown or returned, until the space exists', async () => {
        const http = vi
            .fn<Parameters<HostHttpGet>, ReturnType<HostHttpGet>>()
            .mockRejectedValueOnce({ response: { status: 409 } })
            .mockResolvedValueOnce({ status: 409, data: {} })
            .mockResolvedValueOnce({ status: 200, data: { joinUrl: 'https://meet.test/x' } });
        const { actions, wait, onProgress } = setup(http);
        expect((await actions.startMeet('s1')).kind).toBe('open-url');
        expect(http).toHaveBeenCalledTimes(3);
        expect(wait).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenCalledWith('PROVISIONING');
    });

    it('reports provisioning when the 409 does not clear', async () => {
        const http = vi.fn(() => Promise.reject({ response: { status: 409 } }));
        expect(await setup(http).actions.startMeet('s1')).toEqual({
            kind: 'provisioning',
            provider: 'meet',
        });
        expect(http).toHaveBeenCalledTimes(4);
    });

    it('reports other failures at once', async () => {
        const http = vi.fn(() => Promise.reject({ response: { status: 500 } }));
        expect(await setup(http).actions.startMeet('s1')).toEqual({
            kind: 'failed',
            provider: 'meet',
            status: 500,
        });
        expect(http).toHaveBeenCalledTimes(1);
    });
});

describe('startZoho', () => {
    it('prefers the host link', async () => {
        const http = vi.fn(() => ok({ hostUrl: 'https://z.test/h', joinUrl: 'https://z.test/j' }));
        expect(await setup(http).actions.startZoho('s1', 'https://z.test/f')).toEqual({
            kind: 'open-url',
            provider: 'zoho',
            url: 'https://z.test/h',
        });
    });

    it('falls back to the class link, then to the given link', async () => {
        const joinOnly = vi.fn(() => ok({ hostUrl: null, joinUrl: 'https://z.test/j' }));
        expect(await setup(joinOnly).actions.startZoho('s1', 'https://z.test/f')).toEqual({
            kind: 'open-url',
            provider: 'zoho',
            url: 'https://z.test/j',
            noHostLink: true,
        });
        const none = vi.fn(() => ok({}));
        expect(await setup(none).actions.startZoho('s1', 'https://z.test/f')).toMatchObject({
            url: 'https://z.test/f',
            noHostLink: true,
        });
        expect((await setup(none).actions.startZoho('s1')).kind).toBe('no-url');
    });

    it('still opens the given link when the call fails', async () => {
        const http = vi.fn(() => Promise.reject({ response: { status: 500 } }));
        expect(await setup(http).actions.startZoho('s1', 'https://z.test/f')).toMatchObject({
            url: 'https://z.test/f',
        });
        expect(await setup(http).actions.startZoho('s1')).toEqual({
            kind: 'failed',
            provider: 'zoho',
            status: 500,
        });
    });
});

describe('resolveHostAction', () => {
    const base = { sessionId: 'x', scheduleId: 'y' };
    const http = vi.fn(() => ok({ joinUrl: 'https://bbb.test/join' }));
    const { resolveHostAction } = setup(http).actions;

    it('finds the provider from streaming_type when link_type says nothing', async () => {
        const action = resolveHostAction({ ...base, linkType: 'other', streamingType: 'bbb' });
        expect(action?.kind).toBe('host');
        expect(action?.provider).toBe('bbb');
        expect((await action?.run())?.kind).toBe('open-url');
    });

    it('opens an external link for a provider it cannot host, trimmed and http(s) only', async () => {
        const action = resolveHostAction({
            ...base,
            linkType: 'youtube',
            externalLink: ' https://yt.test/x ',
        });
        expect(action?.kind).toBe('external');
        expect(await action?.run()).toEqual({
            kind: 'open-url',
            provider: 'external',
            url: 'https://yt.test/x',
        });
        expect(resolveHostAction({ ...base, externalLink: 'javascript:x' })).toBeNull();
    });

    it('returns null with nothing to open', () => {
        expect(resolveHostAction(base)).toBeNull();
        expect(resolveHostAction({ sessionId: 'x', scheduleId: '', linkType: 'bbb' })).toBeNull();
    });
});
