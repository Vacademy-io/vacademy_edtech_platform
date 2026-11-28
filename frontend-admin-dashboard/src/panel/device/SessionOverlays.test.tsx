/**
 * The session bars: idle, end of class, the 4 h warning and the toast when the
 * server ends a session. performance.now() is what they run on, so that is the
 * clock these tests move.
 */
import { act, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from './strings';

const session = vi.hoisted(() => ({
    signedIn: true,
    signOut: vi.fn(async () => undefined),
    voltExempt: false,
    endedListener: null as null | ((notice: { reason: string | null }) => void),
}));
const capMs = vi.hoisted(() => ({ value: (4 * 60 * 60 * 1000) as number | null }));
const toastInfo = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ screen: 'home', params: {} }));
const policy = vi.hoisted(() => ({ idle_minutes: 30, session_hours: 4 }));
const serverNow = vi.hoisted(() => ({ value: 1000 }));
const syncSession = vi.hoisted(() => ({
    value: null as null | { phone_connected: boolean },
}));

vi.mock('sonner', () => ({ toast: { info: toastInfo, success: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/api', () => ({ msUntilSessionCap: () => capMs.value }));
vi.mock('../lib/session', () => ({
    isVoltSessionActive: () => false,
    isVoltSessionIdleExempt: () => session.voltExempt,
    signOut: session.signOut,
    subscribeSessionEnded: (listener: (notice: { reason: string | null }) => void) => {
        session.endedListener = listener;
        return () => undefined;
    },
    usePanelSession: () => ({
        isSignedIn: session.signedIn,
        user: session.signedIn ? { fullName: 'Riya', username: 'riya' } : null,
    }),
}));
vi.mock('../router', () => ({
    getCurrentRoute: () => route,
    navigate: navigateMock,
    usePanelRoute: () => route,
}));
vi.mock('./syncLoop', () => ({
    getPanelPolicy: () => policy,
    getServerNow: () => serverNow.value,
    useSyncSnapshot: () => ({ session: syncSession.value }),
}));
vi.mock('./store', () => ({
    useDeviceRecord: () => ({ room_name: 'Room 7B' }),
    usesDeviceAuth: () => true,
}));
vi.mock('./publicApi', () => ({
    isBackendReachable: () => reachable.value,
    subscribeReachability: () => () => undefined,
}));
const reachable = vi.hoisted(() => ({ value: true }));

import { registerTopBar, setMeetingOpen, setOpenedClassEnd } from './activity';
import { SessionCapRow, SessionOverlays } from './SessionOverlays';

const MIN = 60 * 1000;
const barText = strings.en.bars as Record<string, string>;

describe('session overlays', () => {
    let clock = 0;
    beforeAll(async () => {
        await i18next.use(initReactI18next).init({
            lng: 'en',
            resources: { en: { device: strings.en, panel: { topBar: { signOut: 'Sign out' } } } },
            interpolation: { escapeValue: false },
        });
    });
    beforeEach(() => {
        vi.useFakeTimers();
        clock = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        session.signedIn = true;
        session.voltExempt = false;
        session.signOut.mockClear();
        toastInfo.mockClear();
        navigateMock.mockClear();
        capMs.value = 4 * 60 * MIN;
        policy.idle_minutes = 30;
        serverNow.value = 1000;
        syncSession.value = null;
        reachable.value = true;
        setOpenedClassEnd(null);
        setMeetingOpen(false);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });
    const jump = async (ms: number) => {
        clock += ms;
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1100);
        });
        clock += 1100;
    };
    const input = () =>
        act(() => {
            window.dispatchEvent(new Event('pointerdown'));
        });

    /** The Still teaching bar; the chips have a Sign out button of their own. */
    const bar = () =>
        within(screen.getByText('Still teaching?').closest('[role="status"]') as HTMLElement);

    /** What a touch or a mouse press sends, in order. */
    const press = (element: Element) => {
        act(() => {
            element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        });
        act(() => {
            element.dispatchEvent(new Event('pointerup', { bubbles: true }));
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
    };

    it('a press on the Stay button reaches it, and only then does the bar go', async () => {
        render(<SessionOverlays />);
        await jump(30 * MIN);
        const stay = screen.getByRole('button', { name: barText.stay });
        act(() => {
            stay.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        });
        expect(screen.queryByText('Still teaching?')).not.toBeNull();
        press(stay);
        expect(screen.queryByText('Still teaching?')).toBeNull();
        expect(session.signOut).not.toHaveBeenCalled();
    });

    it('a press on the Sign out button signs out', async () => {
        render(<SessionOverlays />);
        await jump(30 * MIN);
        press(bar().getByRole('button', { name: barText.signOutNow }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });
        expect(session.signOut).toHaveBeenCalledWith('IDLE');
    });

    it('Enter on a focused bar button is not taken for general input', async () => {
        render(<SessionOverlays />);
        await jump(30 * MIN);
        const signOutNow = bar().getByRole('button', { name: barText.signOutNow });
        act(() => {
            signOutNow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(screen.queryByText('Still teaching?')).not.toBeNull();
    });

    it('a press anywhere else still drops the bar', async () => {
        render(<SessionOverlays />);
        await jump(30 * MIN);
        act(() => {
            document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        });
        expect(screen.queryByText('Still teaching?')).toBeNull();
    });

    it('with a top bar the session warning sits in its row and covers nothing', async () => {
        const off = registerTopBar();
        capMs.value = 10 * MIN;
        const { container } = render(
            <>
                <SessionCapRow />
                <SessionOverlays />
            </>
        );
        await jump(1000);
        const button = screen.getByRole('button', { name: barText.rescan });
        expect(container.querySelectorAll('.fixed').length).toBe(0);
        expect(button).toBeTruthy();
        off();
    });

    it('shows nothing when signed out', () => {
        session.signedIn = false;
        const { container } = render(<SessionOverlays />);
        expect(container.textContent).toBe('');
    });

    it('idle: the bar at 30 min, a 60 s countdown, then sign-out with reason IDLE', async () => {
        render(<SessionOverlays />);
        await jump(29 * MIN);
        expect(screen.queryByText('Still teaching?')).toBeNull();
        await jump(MIN + 1000);
        expect(screen.getByText('Still teaching?')).toBeTruthy();
        expect(screen.getByText(/Signing out in \d+ seconds/)).toBeTruthy();
        expect(session.signOut).not.toHaveBeenCalled();
        await jump(61 * 1000);
        expect(session.signOut).toHaveBeenCalledWith('IDLE');
    });

    it('idle: input drops the bar and restarts the clock', async () => {
        render(<SessionOverlays />);
        await jump(30 * MIN + 1000);
        expect(screen.getByText('Still teaching?')).toBeTruthy();
        input();
        expect(screen.queryByText('Still teaching?')).toBeNull();
        await jump(29 * MIN);
        expect(screen.queryByText('Still teaching?')).toBeNull();
    });

    it('idle length comes from the server policy', async () => {
        policy.idle_minutes = 10;
        render(<SessionOverlays />);
        await jump(10 * MIN + 1000);
        expect(screen.getByText('Still teaching?')).toBeTruthy();
    });

    it('a live Volt session is exempt', async () => {
        session.voltExempt = true;
        render(<SessionOverlays />);
        await jump(60 * MIN);
        expect(screen.queryByText('Still teaching?')).toBeNull();
    });

    it('a playing video is exempt, a paused one is not', async () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        Object.defineProperty(video, 'ended', { value: false });
        Object.defineProperty(video, 'readyState', { value: 4 });
        document.body.appendChild(video);
        render(<SessionOverlays />);
        await jump(60 * MIN);
        expect(screen.queryByText('Still teaching?')).toBeNull();
        Object.defineProperty(video, 'paused', { value: true, configurable: true });
        await jump(30 * MIN + 1000);
        expect(screen.getByText('Still teaching?')).toBeTruthy();
    });

    it('an open meeting is exempt', async () => {
        setMeetingOpen(true);
        render(<SessionOverlays />);
        await jump(60 * MIN);
        expect(screen.queryByText('Still teaching?')).toBeNull();
    });

    it('end of class: 10 min after the end, with no input in the last 5 min', async () => {
        setOpenedClassEnd(10 * MIN);
        render(<SessionOverlays />);
        serverNow.value = 19 * MIN;
        await jump(6 * MIN);
        expect(screen.queryByText(/This class has ended/)).toBeNull();
        serverNow.value = 20 * MIN + 1;
        await jump(1000);
        expect(screen.getByText(/This class has ended/)).toBeTruthy();
        await jump(61 * 1000);
        expect(session.signOut).toHaveBeenCalledWith('CLASS_END');
    });

    it('end of class: recent input holds it back', async () => {
        setOpenedClassEnd(10 * MIN);
        render(<SessionOverlays />);
        serverNow.value = 30 * MIN;
        await jump(2 * MIN);
        expect(screen.queryByText(/This class has ended/)).toBeNull();
    });

    it('end of class: input during the bar falls back to idle only', async () => {
        setOpenedClassEnd(10 * MIN);
        render(<SessionOverlays />);
        serverNow.value = 30 * MIN;
        await jump(6 * MIN);
        expect(screen.getByText(/This class has ended/)).toBeTruthy();
        input();
        await jump(6 * MIN);
        expect(screen.queryByText(/This class has ended/)).toBeNull();
        await jump(25 * MIN);
        expect(screen.getByText('Still teaching?')).toBeTruthy();
    });

    it('no end time: the end-of-class bar never fires, only idle', async () => {
        setOpenedClassEnd(null);
        render(<SessionOverlays />);
        serverNow.value = 1000 * MIN;
        await jump(29 * MIN);
        expect(screen.queryByText(/This class has ended/)).toBeNull();
        expect(screen.queryByText('Still teaching?')).toBeNull();
    });

    it('warns 15 min before the cap, and a touch does not dismiss it', async () => {
        render(<SessionOverlays />);
        capMs.value = 16 * MIN;
        await jump(0);
        expect(screen.queryByText(/This session ends/)).toBeNull();
        capMs.value = 14 * MIN;
        await jump(0);
        expect(screen.getByText(/This session ends in 14 minutes/)).toBeTruthy();
        input();
        await jump(0);
        expect(screen.getByText(/This session ends in 14 minutes/)).toBeTruthy();
    });

    it('names the reason when the server ends a session', () => {
        render(<SessionOverlays />);
        act(() => session.endedListener?.({ reason: 'SUPERSEDED' }));
        expect(toastInfo).toHaveBeenCalledWith(
            'You signed in on another panel, so this one was signed out'
        );
        act(() => session.endedListener?.({ reason: null }));
        expect(toastInfo).toHaveBeenCalledWith('This session has ended');
    });

    it('chips: name and room with no top bar, phone connected, offline', () => {
        syncSession.value = { phone_connected: true };
        reachable.value = false;
        render(<SessionOverlays />);
        expect(screen.getByText('Riya, Room 7B')).toBeTruthy();
        expect(screen.getByText('Phone connected')).toBeTruthy();
        expect(screen.getByText('Offline')).toBeTruthy();
    });
});
