/**
 * What stays on top of every screen while a paired panel has a session: the name,
 * phone and offline chips, the session-ending bar, the 60-second "Still teaching?"
 * bar (idle and end of class), and the toast when the server ends a session.
 *
 * Idle and end of class use performance.now(), so a wrong or corrected panel clock
 * cannot trip them. A live Volt session, a playing <video> and an open meeting are
 * exempt; the server's 4 h cap still bounds all of them.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DeviceMobile, SignOut, UserCircle, WifiSlash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { PanelConfirmDialog } from '../components/PanelConfirmDialog';
import {
    END_OF_CLASS_GRACE_MS,
    END_OF_CLASS_QUIET_MS,
    SESSION_COUNTDOWN_MS,
    SESSION_WARN_BEFORE_MS,
} from '../config';
import { msUntilSessionCap } from '../lib/api';
import {
    isVoltSessionActive,
    isVoltSessionIdleExempt,
    signOut,
    subscribeSessionEnded,
    usePanelSession,
} from '../lib/session';
import { getCurrentRoute, navigate, usePanelRoute } from '../router';
import {
    getOpenedClassEnd,
    isMeetingOpen,
    isPanelDateWrong,
    isVideoPlaying,
    setOpenedClassEnd,
    subscribePanelActivity,
    useTopBarMounted,
} from './activity';
import { isBackendReachable, subscribeReachability } from './publicApi';
import { useDeviceRecord, usesDeviceAuth } from './store';
import { getPanelPolicy, getServerNow, useSyncSnapshot } from './syncLoop';

type CountdownKind = 'idle' | 'classEnd';

interface BarsState {
    countdown: { kind: CountdownKind; secondsLeft: number } | null;
    /** Whole minutes left on the session, once inside the warning. */
    capMinutes: number | null;
}

const TICK_MS = 1000;

function useReachable(): boolean {
    const [reachable, setReachable] = useState(isBackendReachable);
    useEffect(() => {
        const update = () => setReachable(isBackendReachable());
        update();
        return subscribeReachability(update);
    }, []);
    return reachable;
}

function exemptNow(): boolean {
    return (
        isMeetingOpen() ||
        document.visibilityState === 'hidden' ||
        isVoltSessionIdleExempt() ||
        isVideoPlaying()
    );
}

/** Whole minutes left on the session once inside the warning, else null. */
function capMinutesNow(): number | null {
    const cap = msUntilSessionCap();
    return cap !== null && cap > 0 && cap <= SESSION_WARN_BEFORE_MS
        ? Math.max(1, Math.ceil(cap / 60000))
        : null;
}

function CapWarning({ minutes, className }: { minutes: number; className: string }) {
    const { t } = useTranslation('device');
    return (
        <div
            role="status"
            className={`flex flex-wrap items-center justify-between bg-warning-100 px-6 py-2 ${className}`}
        >
            <p className="py-1 text-title text-neutral-800">
                {t('bars.sessionEnding', { count: minutes })}
            </p>
            <MyButton
                buttonType="primary"
                scale="large"
                className="h-16 px-8"
                onClick={() => navigate('signin')}
            >
                {t('bars.rescan')}
            </MyButton>
        </div>
    );
}

/**
 * The warning before the session cap, as a row under PanelTopBar, so it pushes the screen
 * down instead of covering Back, Home and Sign out.
 */
export function SessionCapRow() {
    const { isSignedIn } = usePanelSession();
    const [minutes, setMinutes] = useState(capMinutesNow);
    useEffect(() => {
        const update = () => setMinutes(capMinutesNow());
        update();
        const timer = window.setInterval(update, TICK_MS);
        return () => window.clearInterval(timer);
    }, []);
    if (!usesDeviceAuth() || !isSignedIn || minutes === null) return null;
    return <CapWarning minutes={minutes} className="shrink-0 border-b border-border" />;
}

/** Idle and end-of-class countdowns, and the warning before the session cap. */
function SessionBars() {
    const { t } = useTranslation('device');
    const route = usePanelRoute();
    const topBar = useTopBarMounted();
    const [state, setState] = useState<BarsState>({ countdown: null, capMinutes: null });
    const lastInputMono = useRef(performance.now());
    const deadlineMono = useRef<number | null>(null);
    const kindRef = useRef<CountdownKind>('idle');
    const barRef = useRef<HTMLDivElement>(null);
    const stayRef = useRef<() => void>(() => undefined);

    useEffect(() => {
        const dropCountdown = () => {
            if (deadlineMono.current !== null && kindRef.current === 'classEnd') {
                // Input during the end-of-class bar: only idle applies from here on.
                setOpenedClassEnd(null);
            }
            deadlineMono.current = null;
            setState((previous) =>
                previous.countdown ? { ...previous, countdown: null } : previous
            );
        };
        const mark = () => {
            lastInputMono.current = performance.now();
            dropCountdown();
        };
        stayRef.current = mark;
        // A press on the bar's own buttons must reach them: removing the bar on pointerdown
        // sends the click to whatever is underneath. Those buttons act on click instead.
        const onInput = (event: Event) => {
            const bar = barRef.current;
            if (bar && event.target instanceof Node && bar.contains(event.target)) return;
            mark();
        };
        const events = ['pointerdown', 'keydown', 'wheel'];
        events.forEach((name) => window.addEventListener(name, onInput, { passive: true }));
        const offActivity = subscribePanelActivity(mark);

        const tick = () => {
            const now = performance.now();
            if (exemptNow()) {
                lastInputMono.current = now;
                dropCountdown();
            }
            const quietMs = now - lastInputMono.current;
            if (deadlineMono.current === null) {
                const idleMs = getPanelPolicy().idle_minutes * 60 * 1000;
                const classEnd = getOpenedClassEnd();
                if (quietMs >= idleMs) {
                    kindRef.current = 'idle';
                    deadlineMono.current = now + SESSION_COUNTDOWN_MS;
                } else if (
                    classEnd !== null &&
                    getServerNow() >= classEnd + END_OF_CLASS_GRACE_MS &&
                    quietMs >= END_OF_CLASS_QUIET_MS
                ) {
                    kindRef.current = 'classEnd';
                    deadlineMono.current = now + SESSION_COUNTDOWN_MS;
                }
            }
            let countdown: BarsState['countdown'] = null;
            if (deadlineMono.current !== null) {
                const left = deadlineMono.current - now;
                if (left <= 0) {
                    const reason = kindRef.current === 'idle' ? 'IDLE' : 'CLASS_END';
                    deadlineMono.current = null;
                    setOpenedClassEnd(null);
                    void signOut(reason).then(() => {
                        toast.info(t(`ended.${reason}`));
                        navigate('home', undefined, { replace: true });
                    });
                } else {
                    countdown = { kind: kindRef.current, secondsLeft: Math.ceil(left / 1000) };
                }
            }
            const capMinutes = capMinutesNow();
            setState((previous) =>
                previous.capMinutes === capMinutes &&
                previous.countdown?.kind === countdown?.kind &&
                previous.countdown?.secondsLeft === countdown?.secondsLeft
                    ? previous
                    : { countdown, capMinutes }
            );
        };
        const timer = window.setInterval(tick, TICK_MS);
        return () => {
            events.forEach((name) => window.removeEventListener(name, onInput));
            offActivity();
            window.clearInterval(timer);
        };
    }, [t]);

    const { countdown, capMinutes } = state;
    return (
        <>
            {countdown && (
                <div
                    ref={barRef}
                    role="status"
                    className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-between bg-warning-100 px-6 py-3 shadow-md"
                >
                    <div className="py-1">
                        <p className="text-h3 font-semibold text-neutral-800">
                            {countdown.kind === 'idle'
                                ? t('bars.stillTeaching')
                                : t('bars.classOver')}
                        </p>
                        <p className="text-subtitle tabular-nums text-neutral-700">
                            {t('bars.signingOutIn', { count: countdown.secondsLeft })}
                        </p>
                    </div>
                    <div className="flex items-center space-x-4">
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            className="h-16 px-8"
                            onClick={() => stayRef.current()}
                        >
                            {t('bars.stay')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="large"
                            className="h-16 px-8"
                            onAsyncClick={async () => {
                                await signOut(kindRef.current === 'idle' ? 'IDLE' : 'CLASS_END');
                                navigate('home', undefined, { replace: true });
                            }}
                        >
                            {t('bars.signOutNow')}
                        </MyButton>
                    </div>
                </div>
            )}
            {/* With a top bar, SessionCapRow shows this in flow under it instead. */}
            {!countdown && capMinutes !== null && !topBar && route.screen !== 'signin' && (
                <CapWarning minutes={capMinutes} className="fixed inset-x-0 top-0 z-40 shadow-md" />
            )}
        </>
    );
}

function Chip({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <span className="pointer-events-none flex h-12 items-center space-x-2 rounded-full border border-border bg-card px-4 text-subtitle text-neutral-700 shadow-sm">
            {icon}
            <span className="max-w-xs truncate">{text}</span>
        </span>
    );
}

function SessionChips() {
    const { t } = useTranslation('device');
    const { user, isSignedIn } = usePanelSession();
    const device = useDeviceRecord();
    const sync = useSyncSnapshot();
    const reachable = useReachable();
    const topBar = useTopBarMounted();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [liveSession, setLiveSession] = useState(false);
    const { t: tp } = useTranslation('panel');
    if (!isSignedIn || !user) return null;
    // PanelTopBar shows all of this itself.
    if (topBar) return null;
    const name = user.fullName || user.username;
    const dateWrong = !reachable && isPanelDateWrong();
    return (
        <div className="pointer-events-none fixed left-4 top-24 z-40 flex flex-col items-start space-y-2">
            <span className="pointer-events-auto flex items-center space-x-2 rounded-full border border-border bg-card py-1 pl-4 pr-1 text-subtitle text-neutral-700 shadow-sm">
                <UserCircle size={24} className="shrink-0" aria-hidden />
                <span className="max-w-xs truncate">
                    {t('chips.name', { name, room: device?.room_name ?? '' })}
                </span>
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="large"
                    className="size-16 rounded-full"
                    aria-label={tp('topBar.signOut')}
                    onClick={() => {
                        setLiveSession(isVoltSessionActive());
                        setConfirmOpen(true);
                    }}
                >
                    <SignOut size={28} />
                </MyButton>
            </span>
            {sync.session?.phone_connected && (
                <Chip
                    icon={<DeviceMobile size={24} className="text-success-600" aria-hidden />}
                    text={t('chips.phoneConnected')}
                />
            )}
            {!reachable && (
                <Chip
                    icon={<WifiSlash size={24} className="text-danger-500" aria-hidden />}
                    text={dateWrong ? t('chips.wrongDate') : t('chips.offline')}
                />
            )}
            <PanelConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={liveSession ? tp('topBar.signOutLiveTitle') : tp('topBar.signOutTitle')}
                description={liveSession ? tp('topBar.signOutLiveBody') : tp('topBar.signOutBody')}
                confirmLabel={tp('topBar.signOut')}
                onConfirm={async () => {
                    await signOut();
                    navigate('home', undefined, { replace: true });
                }}
            />
        </div>
    );
}

export function SessionOverlays() {
    const { t } = useTranslation('device');
    const { isSignedIn } = usePanelSession();

    useEffect(
        () =>
            subscribeSessionEnded(({ reason }) => {
                setOpenedClassEnd(null);
                toast.info(t(`ended.${reason ?? 'UNKNOWN'}`));
                if (getCurrentRoute().screen === 'signin') {
                    navigate('home', undefined, { replace: true });
                }
            }),
        [t]
    );

    if (!usesDeviceAuth() || !isSignedIn) return null;
    return (
        <>
            <SessionBars />
            <SessionChips />
        </>
    );
}
