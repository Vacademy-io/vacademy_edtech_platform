import { describe, expect, it, vi } from 'vitest';
import { createHostActions } from '@/classroom-shared/hostActions';
import type { PanelOpenResult } from '../lib/native';
import { providerOfClass, startClass, startNewRoom, type StartDeps } from './startClass';
import { makeClass } from './testRows';

const JOIN = 'https://bbb.example.test/join?moderator=1';

function setup(overrides: Partial<StartDeps> = {}, http?: (path: string) => unknown) {
    const requests: string[] = [];
    const host = createHostActions(async (path) => {
        requests.push(path);
        const data = http ? http(path) : { joinUrl: JOIN };
        if (data instanceof Error) throw data;
        return { status: 200, data };
    });
    let meetingOpen = false;
    const settled: PanelOpenResult[] = [];
    const deps: StartDeps = {
        host,
        webViewMajor: () => Promise.resolve(109),
        bbbInAppMinWebview: () => 91,
        hasMeetingScreen: () => true,
        isMeetingOpen: () => meetingOpen,
        setMeetingOpen: (open) => {
            meetingOpen = open;
        },
        setOpenedClassEnd: vi.fn(),
        openMeeting: vi.fn(async () => ({ opened: true })),
        openExternal: vi.fn(async () => ({ opened: true })),
        onMeetingSettled: (result) => settled.push(result),
        isCancelled: () => false,
        ...overrides,
    };
    return { deps, requests, settled, isOpen: () => meetingOpen };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startClass', () => {
    it('BBB above the flag opens the meeting screen, and tracks it being open', async () => {
        let close: (value: PanelOpenResult) => void = () => undefined;
        const openMeeting = vi.fn(
            () =>
                new Promise<PanelOpenResult>((resolve) => {
                    close = resolve;
                })
        );
        const { deps, settled, isOpen } = setup({ openMeeting });
        const item = makeClass({ ends_at_ms: 123 });
        await expect(startClass(item, deps)).resolves.toEqual({ kind: 'meeting' });
        expect(openMeeting).toHaveBeenCalledWith(JOIN);
        expect(deps.setOpenedClassEnd).toHaveBeenCalledWith(123);
        expect(isOpen()).toBe(true);
        expect(settled).toEqual([]);

        close({ opened: true });
        await tick();
        expect(isOpen()).toBe(false);
        expect(settled).toEqual([{ opened: true }]);
    });

    it('BBB below the flag goes to the device with no backend call', async () => {
        const { deps, requests } = setup({ bbbInAppMinWebview: () => 9999 });
        await expect(startClass(makeClass(), deps)).resolves.toEqual({
            kind: 'device',
            reason: 'unsupported',
        });
        expect(requests).toEqual([]);
        expect(deps.openMeeting).not.toHaveBeenCalled();
    });

    it('a panel with no meeting screen goes to the device with no backend call', async () => {
        const { deps, requests } = setup({ hasMeetingScreen: () => false });
        await expect(startClass(makeClass(), deps)).resolves.toEqual({
            kind: 'device',
            reason: 'no-meeting-screen',
        });
        expect(requests).toEqual([]);
    });

    it.each(['zoom', 'google meet', 'zoom_meeting'])('%s goes to the device', async (link) => {
        const { deps, requests } = setup();
        const item = makeClass({ link_type: link, streaming_type: link });
        await expect(startClass(item, deps)).resolves.toMatchObject({ kind: 'device' });
        expect(requests).toEqual([]);
    });

    it('a null end time clears any earlier class end', async () => {
        const { deps } = setup();
        await startClass(makeClass({ link_type: 'zoom', ends_at_ms: null }), deps);
        expect(deps.setOpenedClassEnd).toHaveBeenCalledWith(null);
    });

    it('swapped provider columns still find the provider', async () => {
        const item = makeClass({ link_type: 'youtube', streaming_type: 'zoom' });
        expect(providerOfClass(item)).toBe('zoom');
    });

    it('MEETING_ENDED asks, and a new room opens the meeting screen', async () => {
        const params: boolean[] = [];
        const { deps } = setup({
            host: createHostActions(async (_path, query) => {
                params.push(query.recreate === true);
                return {
                    status: 200,
                    data: query.recreate ? { joinUrl: JOIN } : { status: 'MEETING_ENDED' },
                };
            }),
        });
        const item = makeClass();
        await expect(startClass(item, deps)).resolves.toEqual({
            kind: 'meeting-ended',
            scheduleId: 'sched-1',
        });
        expect(deps.openMeeting).not.toHaveBeenCalled();
        await expect(startNewRoom(item, deps)).resolves.toEqual({ kind: 'meeting' });
        expect(params).toEqual([false, true]);
        expect(deps.openMeeting).toHaveBeenCalledWith(JOIN);
    });

    it('RECREATE_BLOCKED carries the server message', async () => {
        const { deps } = setup({}, () => ({ status: 'RECREATE_BLOCKED', message: 'In use' }));
        await expect(startNewRoom(makeClass(), deps)).resolves.toEqual({
            kind: 'recreate-blocked',
            message: 'In use',
        });
    });

    it('a failed request is reported, not swallowed', async () => {
        const { deps } = setup({}, () => new Error('boom'));
        await expect(startClass(makeClass(), deps)).resolves.toEqual({ kind: 'failed' });
    });

    it('an answer with no link says so', async () => {
        const { deps } = setup({}, () => ({}));
        await expect(startClass(makeClass(), deps)).resolves.toEqual({ kind: 'no-url' });
    });

    it('a second start while a meeting is up is refused before any request', async () => {
        const { deps, requests } = setup({ isMeetingOpen: () => true });
        await expect(startClass(makeClass(), deps)).resolves.toEqual({ kind: 'already-open' });
        expect(requests).toEqual([]);
    });

    it('ALREADY_OPEN from native leaves the flag up', async () => {
        const { deps, settled, isOpen } = setup({
            openMeeting: async () => ({ opened: false, reason: 'ALREADY_OPEN' }),
        });
        await startClass(makeClass(), deps);
        await tick();
        expect(isOpen()).toBe(true);
        expect(settled).toEqual([{ opened: false, reason: 'ALREADY_OPEN' }]);
    });

    it('an older APK reports back through settled and drops the flag', async () => {
        const { deps, settled, isOpen } = setup({
            openMeeting: async () => ({ opened: false, reason: 'NO_PLUGIN' }),
        });
        await startClass(makeClass(), deps);
        await tick();
        expect(isOpen()).toBe(false);
        expect(settled[0]?.reason).toBe('NO_PLUGIN');
    });

    it('an answer after the teacher left opens nothing', async () => {
        let cancelled = false;
        const { deps } = setup({ isCancelled: () => cancelled }, () => {
            cancelled = true;
            return { joinUrl: JOIN };
        });
        await expect(startClass(makeClass(), deps)).resolves.toEqual({ kind: 'cancelled' });
        expect(deps.openMeeting).not.toHaveBeenCalled();
    });

    describe('Zoho and external links', () => {
        const zoho = makeClass({
            schedule_id: 'z',
            link_type: 'zoho',
            streaming_type: 'zoho',
            external_link: null,
        });

        it('open in another app, and record the class', async () => {
            const { deps } = setup({}, () => ({ hostUrl: 'https://z.example.test/start' }));
            await expect(startClass(zoho, deps)).resolves.toEqual({
                kind: 'external',
                noHostLink: false,
            });
            expect(deps.openExternal).toHaveBeenCalledWith('https://z.example.test/start');
            expect(deps.openMeeting).not.toHaveBeenCalled();
            expect(deps.setOpenedClassEnd).toHaveBeenCalled();
        });

        it('flag a class link used because there was no host link', async () => {
            const { deps } = setup({}, () => ({
                hostUrl: null,
                joinUrl: 'https://z.example.test/j',
            }));
            await expect(startClass(zoho, deps)).resolves.toEqual({
                kind: 'external',
                noHostLink: true,
            });
        });

        it('with no browser, go to the device', async () => {
            const { deps } = setup(
                { openExternal: async () => ({ opened: false, reason: 'NO_HANDLER' }) },
                () => ({ hostUrl: 'https://z.example.test/start' })
            );
            await expect(startClass(zoho, deps)).resolves.toEqual({
                kind: 'device',
                reason: 'no-browser',
            });
        });

        it('a plain external link needs no backend call', async () => {
            const { deps, requests } = setup();
            const item = makeClass({
                link_type: 'youtube',
                streaming_type: 'other',
                external_link: 'https://y.example.test/live',
            });
            await expect(startClass(item, deps)).resolves.toMatchObject({ kind: 'external' });
            expect(requests).toEqual([]);
        });

        it('an external link that is not https is refused by native and goes to the device', async () => {
            const { deps } = setup({
                openExternal: async () => ({ opened: false, reason: 'INVALID_URL' }),
            });
            const item = makeClass({
                link_type: 'other',
                streaming_type: 'other',
                external_link: 'http://y.example.test/live',
            });
            await expect(startClass(item, deps)).resolves.toEqual({
                kind: 'device',
                reason: 'no-browser',
            });
        });
    });

    it('no provider and no link is no-link', async () => {
        const { deps } = setup();
        const item = makeClass({ link_type: null, streaming_type: null, external_link: null });
        expect(providerOfClass(item)).toBeNull();
        await expect(startClass(item, deps)).resolves.toEqual({ kind: 'no-link' });
    });

    it('a stored join URL is never handed to anything but the meeting screen', async () => {
        const { deps } = setup();
        await startClass(makeClass(), deps);
        expect(deps.openExternal).not.toHaveBeenCalled();
    });
});
