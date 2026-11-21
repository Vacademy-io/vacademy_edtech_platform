/**
 * The strip against a faked backend: the states on screen, default focus, and the
 * dialogs a Start leads to. Panel behaviour on a real WebView is covered on emulators.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import panelEn from '../i18n/panel.en.json';
import { strings } from './strings';
import { clearTodayCache } from './todayCache';
import TodayStrip from './TodayStrip';
import { MIN, T0, makeClass } from './testRows';
import type { TodayClass } from '@/classroom-shared/apiTypes';

const env = vi.hoisted(() => ({
    responses: { mine: null as unknown, all: null as unknown },
    join: {} as unknown,
    calls: [] as Array<{ url: string; params: Record<string, unknown> }>,
    major: 66,
    flag: 9999,
    native: false,
    phoneConnected: false,
    base: 'https://dash.example.test' as string | null,
    openMeeting: vi.fn<[string], Promise<{ opened: boolean; reason?: string }>>(async () => ({
        opened: true,
    })),
    openExternal: vi.fn<[string], Promise<{ opened: boolean; reason?: string }>>(async () => ({
        opened: true,
    })),
    setOpenedClassEnd: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));
vi.mock('@/constants/urls', () => ({ BASE_URL: 'http://backend.test' }));
vi.mock('react-qr-code', () => ({
    default: ({ value }: { value: string }) => <svg data-testid="qr" data-value={value} />,
}));
vi.mock('../lib/api', () => ({
    panelApi: {
        get: vi.fn(async (url: string, config: { params: Record<string, unknown> }) => {
            env.calls.push({ url, params: config.params });
            if (url.indexOf('/classroom/v1/today') >= 0) {
                const body = env.responses[config.params.scope as 'mine' | 'all'];
                if (body instanceof Error) throw body;
                return { status: 200, data: body };
            }
            return { status: 200, data: env.join };
        }),
    },
}));
vi.mock('../lib/native', () => ({
    isNativePanel: () => env.native,
    getPanelDevice: () => (env.native ? {} : null),
    openDeviceSettings: vi.fn(async () => true),
    openMeeting: env.openMeeting,
    openExternal: env.openExternal,
}));
vi.mock('../device/deviceInfo', () => ({
    getWebViewMajor: () => env.major,
    loadPanelDeviceInfo: async () => null,
}));
vi.mock('../device/publicApi', () => ({
    isBackendReachable: () => true,
    subscribeReachability: () => () => undefined,
}));
vi.mock('../device/syncLoop', () => ({
    getPanelFlags: () => ({ bbb_in_app_min_webview: env.flag }),
    syncNow: vi.fn(),
    useSyncSnapshot: () => ({
        flags: { bbb_in_app_min_webview: env.flag },
        session: { phone_connected: env.phoneConnected },
    }),
}));
vi.mock('../device/store', () => ({
    useDeviceRecord: () => ({ institute_id: 'inst-a', approve_base_url: env.base }),
}));
vi.mock('../device/activity', () => ({
    isMeetingOpen: () => false,
    isPanelDateWrong: () => false,
    setMeetingOpen: vi.fn(),
    setOpenedClassEnd: env.setOpenedClassEnd,
}));

const today = (classes: TodayClass[]) => ({ server_time_ms: T0, classes, truncated: false });

/** Each test gets its own teacher, so a remembered Mine/All choice cannot leak between them. */
let userSerial = 0;

function show() {
    userSerial += 1;
    return render(<TodayStrip userId={`u${userSerial}`} instituteId="inst-a" />);
}

describe('TodayStrip', () => {
    beforeAll(async () => {
        await i18next.use(initReactI18next).init({
            lng: 'en',
            resources: { en: { classes: strings.en, panel: panelEn } },
            ns: ['classes', 'panel'],
            defaultNS: 'panel',
            interpolation: { escapeValue: false },
        });
    });

    beforeEach(() => {
        clearTodayCache();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(T0 - 5 * MIN);
        Object.assign(env, {
            responses: { mine: today([]), all: today([]) },
            join: {},
            calls: [],
            major: 66,
            flag: 9999,
            native: false,
            phoneConnected: false,
            base: 'https://dash.example.test',
        });
        env.openMeeting.mockClear();
        env.openExternal.mockClear();
        env.setOpenedClassEnd.mockClear();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows the time label from the server, not one from this panel', async () => {
        env.responses.mine = today([makeClass({ time_label: '07:45' })]);
        show();
        await screen.findByText('07:45');
        expect(screen.getByText('Forces')).toBeTruthy();
    });

    it('status comes from server time even when the panel clock is days off', async () => {
        vi.setSystemTime(T0 - 3 * 24 * 60 * MIN);
        env.responses.mine = {
            server_time_ms: T0 - 5 * MIN,
            classes: [makeClass()],
            truncated: false,
        };
        show();
        await screen.findByText('In 5 min');
    });

    it('Mine empty: All with the label, and the toggle stays', async () => {
        env.responses.all = today([makeClass({ title: 'Someone else' })]);
        show();
        await screen.findByText('Someone else');
        expect(screen.getByText('All classes today')).toBeTruthy();
        expect(screen.getByText('You have no classes of your own today.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Mine' })).toBeTruthy();
    });

    it('all empty: the message, and no card', async () => {
        show();
        await screen.findByText('No live classes scheduled today.');
        expect(document.querySelector('[data-class-card]')).toBeNull();
    });

    it('error with no list: message and Retry, which works', async () => {
        env.responses.mine = Object.assign(new Error('500'), {
            isAxiosError: true,
            response: { status: 500 },
        });
        show();
        await screen.findByText("Couldn't load today's classes.");
        env.responses.mine = today([makeClass()]);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Forces');
        expect(screen.queryByText("Couldn't load today's classes.")).toBeNull();
    });

    it('offline with a stored list: the list and As of', async () => {
        env.responses.mine = today([makeClass()]);
        const first = show();
        await screen.findByText('Forces');
        const user = `u${userSerial}`;
        first.unmount();

        env.responses.mine = Object.assign(new Error('net'), { isAxiosError: true });
        render(<TodayStrip userId={user} instituteId="inst-a" />);
        await screen.findByText('No internet.');
        expect(screen.getByText('Forces')).toBeTruthy();
        expect(screen.getByText('As of 10:00')).toBeTruthy();
    });

    it('the first class takes focus, and a Done class gives way to the next', async () => {
        env.responses.mine = today([
            makeClass({
                schedule_id: 'old',
                title: 'Morning',
                starts_at_ms: T0 - 120 * MIN,
                ends_at_ms: T0 - 60 * MIN,
            }),
            makeClass({ schedule_id: 'next', title: 'Next up' }),
        ]);
        show();
        await screen.findByText('Next up');
        await waitFor(() => {
            expect(document.activeElement?.getAttribute('data-class-card')).toBe('next');
        });
    });

    it('a fresh list that replaces the focused card hands focus to the new first class', async () => {
        env.responses.mine = today([makeClass({ schedule_id: 'stored', title: 'Stored' })]);
        const first = show();
        await screen.findByText('Stored');
        const user = `u${userSerial}`;
        first.unmount();

        env.responses.mine = today([makeClass({ schedule_id: 'fresh', title: 'Fresh' })]);
        render(<TodayStrip userId={user} instituteId="inst-a" />);
        await screen.findByText('Fresh');
        await waitFor(() => {
            expect(document.activeElement?.getAttribute('data-class-card')).toBe('fresh');
        });
    });

    it('does not take focus from something the teacher already moved to', async () => {
        env.responses.mine = today([makeClass()]);
        const elsewhere = document.createElement('button');
        document.body.appendChild(elsewhere);
        elsewhere.focus();
        show();
        await screen.findByText('Forces');
        expect(document.activeElement).toBe(elsewhere);
        elsewhere.remove();
    });

    it('BBB on WebView 66: device QR holding the ids only, and no join call', async () => {
        env.responses.mine = today([makeClass({ ends_at_ms: T0 + 45 * MIN })]);
        env.join = { joinUrl: 'https://bbb.example.test/join?moderator=1' };
        show();
        fireEvent.click(await screen.findByText('Forces'));
        const qr = await screen.findByTestId('qr');
        expect(qr.getAttribute('data-value')).toBe(
            'https://dash.example.test/classroom#s=sched-1&i=inst-a'
        );
        expect(env.calls.some((c) => c.url.indexOf('/meeting/') >= 0)).toBe(false);
        expect(env.setOpenedClassEnd).toHaveBeenCalledWith(T0 + 45 * MIN);
        expect(screen.queryByText('Your phone page already shows this class.')).toBeNull();
    });

    it('with a phone connected the dialog says so', async () => {
        env.responses.mine = today([makeClass()]);
        env.phoneConnected = true;
        show();
        fireEvent.click(await screen.findByText('Forces'));
        await screen.findByText('Your phone page already shows this class.');
    });

    it('no address yet: says so, with Retry, rather than an empty QR', async () => {
        env.responses.mine = today([makeClass()]);
        env.base = null;
        show();
        fireEvent.click(await screen.findByText('Forces'));
        await screen.findByText(/hasn't reached the server/);
        expect(screen.queryByTestId('qr')).toBeNull();
    });

    it('flag lowered on a new WebView: ended dialog, then the meeting screen', async () => {
        Object.assign(env, { major: 109, flag: 91, native: true });
        env.responses.mine = today([makeClass()]);
        env.join = { status: 'MEETING_ENDED' };
        show();
        fireEvent.click(await screen.findByText('Forces'));
        await screen.findByText('This class has ended');
        expect(env.openMeeting).not.toHaveBeenCalled();

        env.join = { joinUrl: 'https://bbb.example.test/join' };
        fireEvent.click(screen.getByRole('button', { name: 'Start a new room' }));
        await waitFor(() => {
            expect(env.openMeeting).toHaveBeenCalledWith('https://bbb.example.test/join');
        });
        const recreate = env.calls.filter((c) => c.params.recreate === true);
        expect(recreate).toHaveLength(1);
    });

    it('a new room refused shows the server message', async () => {
        Object.assign(env, { major: 109, flag: 91, native: true });
        env.responses.mine = today([makeClass()]);
        env.join = { status: 'MEETING_ENDED' };
        show();
        fireEvent.click(await screen.findByText('Forces'));
        await screen.findByText('This class has ended');
        env.join = { status: 'RECREATE_BLOCKED', message: 'Learners are in the room.' };
        fireEvent.click(screen.getByRole('button', { name: 'Start a new room' }));
        await screen.findByText('Learners are in the room.');
    });

    it('an older APK falls back to the device QR after the join answer', async () => {
        Object.assign(env, { major: 109, flag: 91, native: true });
        env.responses.mine = today([makeClass()]);
        env.join = { joinUrl: 'https://bbb.example.test/join?moderator=1' };
        env.openMeeting.mockImplementationOnce(async () => ({
            opened: false,
            reason: 'NO_PLUGIN',
        }));
        show();
        fireEvent.click(await screen.findByText('Forces'));
        const qr = await screen.findByTestId('qr');
        expect(qr.getAttribute('data-value')).not.toContain('moderator');
        expect(qr.getAttribute('data-value')).not.toContain('bbb.example.test');
    });

    it('external link with no browser: device QR', async () => {
        env.native = true;
        env.responses.mine = today([
            makeClass({
                link_type: 'other',
                streaming_type: 'other',
                external_link: 'https://x.example.test/room',
            }),
        ]);
        env.openExternal.mockImplementationOnce(async () => ({
            opened: false,
            reason: 'NO_HANDLER',
        }));
        show();
        fireEvent.click(await screen.findByText('Forces'));
        const qr = await screen.findByTestId('qr');
        expect(qr.getAttribute('data-value')).not.toContain('x.example.test');
    });

    it('a second press soon after opening a link goes to the device QR', async () => {
        env.native = true;
        env.responses.mine = today([
            makeClass({
                link_type: 'other',
                streaming_type: 'other',
                external_link: 'https://x.example.test/room',
            }),
        ]);
        show();
        const card = await screen.findByText('Forces');
        fireEvent.click(card);
        await waitFor(() => {
            expect(env.openExternal).toHaveBeenCalledTimes(1);
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.queryByTestId('qr')).toBeNull();
        fireEvent.click(card);
        await screen.findByTestId('qr');
        expect(env.openExternal).toHaveBeenCalledTimes(1);
    });

    it('a class with no link cannot be started and says why', async () => {
        env.responses.mine = today([
            makeClass({ link_type: null, streaming_type: null, external_link: null }),
        ]);
        show();
        const card = (await screen.findByText('No class link')).closest('button');
        expect(card?.disabled).toBe(true);
    });

    it('a teacher leaving the screen takes the dialog with it', async () => {
        env.responses.mine = today([makeClass()]);
        const view = show();
        fireEvent.click(await screen.findByText('Forces'));
        await screen.findByTestId('qr');
        act(() => view.unmount());
        expect(screen.queryByTestId('qr')).toBeNull();
        expect(screen.queryByText('Forces')).toBeNull();
    });
});
