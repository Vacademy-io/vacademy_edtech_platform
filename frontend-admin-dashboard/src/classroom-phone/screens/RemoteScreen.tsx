/**
 * The phone remote. It shows only what the last /remote/state returned; the panel
 * is the only thing that moves slides. The remote token needs no JWT, so the
 * buttons keep working after the page's sign-in expires. Today needs one.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { RemoteStateResponse } from '@/classroom-shared/apiTypes';
import { SignInForm } from '../components/SignInForm';
import { TodayList } from '../components/TodayList';
import { ActionButton, Spinner, StateCard } from '../components/ui';
import { remoteEnd, remoteNav, remoteState, resolveInstitute } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorKind, PhoneApiError } from '../lib/http';
import { createNavQueue, type NavQueue } from '../lib/navQueue';
import { clearRemote, getSeq, saveSeq, type StoredRemote } from '../lib/remoteStore';
import { applyTheme } from '../lib/theme';
import { fill, useStrings } from '../strings';

const POLL_MS = 2000;
const POLL_FAILURE_MS = 4000;

const NAV_BUTTON =
    'flex h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 text-h3 transition-colors disabled:opacity-40';

/** Keeps the screen on while teaching. Absent on some phones, and refused when hidden. */
function useWakeLock(): void {
    useEffect(() => {
        const wakeLock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
        if (!wakeLock) return undefined;
        let sentinel: WakeLockSentinel | null = null;
        let live = true;
        const acquire = () => {
            if (document.hidden) return;
            wakeLock
                .request('screen')
                .then((next) => {
                    if (live) sentinel = next;
                    else void next.release();
                })
                .catch(() => undefined);
        };
        acquire();
        document.addEventListener('visibilitychange', acquire);
        return () => {
            live = false;
            document.removeEventListener('visibilitychange', acquire);
            void sentinel?.release();
        };
    }, []);
}

export function RemoteScreen({
    remote,
    onSessionEnded,
}: {
    remote: StoredRemote;
    /** Called just before the stored token goes, because this screen goes with it. */
    onSessionEnded: () => void;
}) {
    const s = useStrings();
    const { signedIn } = useAuth();
    const { token } = remote;
    const [state, setState] = useState<RemoteStateResponse | null>(null);
    const [offlineNet, setOfflineNet] = useState(false);
    const [notDelivered, setNotDelivered] = useState(false);
    const [confirmEnd, setConfirmEnd] = useState(false);
    const [endFailed, setEndFailed] = useState(false);
    const [showSignIn, setShowSignIn] = useState(false);
    const queueRef = useRef<NavQueue | null>(null);

    useWakeLock();

    // A remote connected through a typed code never saw a theme.
    const brandingInstitute = remote.themeCode ? null : state?.institute_id ?? null;
    useEffect(() => {
        if (!brandingInstitute) return;
        void resolveInstitute(brandingInstitute).then((branding) =>
            applyTheme(branding?.instituteThemeCode)
        );
    }, [brandingInstitute]);

    const onEnded = useMemo(
        () => () => {
            onSessionEnded();
            clearRemote();
        },
        [onSessionEnded]
    );

    useEffect(() => {
        const queue = createNavQueue({
            send: (delta, seq) => remoteNav(token, delta, seq),
            getSeq: () => getSeq(token),
            saveSeq: (seq) => saveSeq(token, seq),
            isRetryable: (error) => {
                const kind = errorKind(error);
                return kind === 'network' || kind === 'busy';
            },
            onDelivered: () => setNotDelivered(false),
            onNotDelivered: () => setNotDelivered(true),
            onEnded,
        });
        queueRef.current = queue;
        return () => {
            queue.stop();
            queueRef.current = null;
        };
    }, [token, onEnded]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let live = true;
        let inFlight = false;

        const schedule = (ms: number) => {
            if (timer) clearTimeout(timer);
            if (live && !document.hidden) timer = setTimeout(poll, ms);
        };

        function poll() {
            if (!live || document.hidden || inFlight) return;
            inFlight = true;
            remoteState(token)
                .then((next) => {
                    if (!live) return;
                    setOfflineNet(false);
                    if (next.status === 'ENDED') {
                        onEnded();
                        return;
                    }
                    setState(next);
                    schedule(POLL_MS);
                })
                .catch((error: unknown) => {
                    if (!live) return;
                    setOfflineNet(true);
                    const retryAfter =
                        error instanceof PhoneApiError
                            ? (error.body as { retry_after_ms?: number } | null)?.retry_after_ms
                            : undefined;
                    schedule(Math.max(retryAfter ?? 0, POLL_FAILURE_MS));
                })
                .finally(() => {
                    inFlight = false;
                });
        }

        const onVisibility = () => {
            if (document.hidden) {
                if (timer) clearTimeout(timer);
                timer = null;
            } else {
                poll();
            }
        };

        document.addEventListener('visibilitychange', onVisibility);
        poll();
        return () => {
            live = false;
            if (timer) clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [token, onEnded]);

    if (!state) {
        return offlineNet ? (
            <StateCard tone="offline" testId="remote-offline-net" title={s.reconnecting} />
        ) : (
            <Spinner label={s.connecting} />
        );
    }

    const room = state.room_name ?? remote.roomName ?? s.aRoom;
    const hasTarget = state.index !== null && state.total !== null;
    const enabled = state.panel_online && hasTarget;
    const instituteId = state.institute_id ?? remote.instituteId;

    const press = (delta: 1 | -1) => {
        setNotDelivered(false);
        queueRef.current?.press(delta);
    };

    const end = () => {
        setEndFailed(false);
        remoteEnd(token)
            .then(onEnded)
            .catch(() => setEndFailed(true));
    };

    return (
        <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-3" data-state="remote">
                <header className="text-center">
                    <h1 className="text-h3 text-foreground">{room}</h1>
                    {!state.panel_online && (
                        <div data-state="panel-offline">
                            <p className="text-subtitle text-danger-600">{s.panelOffline}</p>
                            <p className="text-body text-muted-foreground">{s.panelOfflineBody}</p>
                        </div>
                    )}
                    {state.panel_online && !hasTarget && (
                        <p className="text-subtitle text-muted-foreground" data-state="no-target">
                            {s.useThePanel}
                        </p>
                    )}
                    {state.panel_online && hasTarget && (
                        <>
                            <p
                                className="text-subtitle text-foreground"
                                data-state="slide-position"
                            >
                                {fill(s.slideOf, {
                                    index: (state.index ?? 0) + 1,
                                    total: state.total ?? 0,
                                })}
                            </p>
                            {state.title && (
                                <p className="truncate text-body text-muted-foreground">
                                    {state.title}
                                </p>
                            )}
                        </>
                    )}
                </header>

                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        data-nav="prev"
                        disabled={!enabled}
                        onClick={() => press(-1)}
                        className={`${NAV_BUTTON} phone-press border-border bg-card text-foreground`}
                    >
                        <CaretLeft className="size-10" />
                        {s.previous}
                    </button>
                    <button
                        type="button"
                        data-nav="next"
                        disabled={!enabled}
                        onClick={() => press(1)}
                        className={`${NAV_BUTTON} border-primary-500 bg-primary-500 text-neutral-50 active:bg-primary-400`}
                    >
                        <CaretRight className="size-10" />
                        {s.next}
                    </button>
                </div>

                {notDelivered && (
                    <p
                        role="alert"
                        data-state="not-delivered"
                        className="text-center text-subtitle text-danger-600"
                    >
                        {s.notDelivered}
                    </p>
                )}
                {offlineNet && (
                    <p
                        role="status"
                        data-state="reconnecting"
                        className="text-center text-body text-muted-foreground"
                    >
                        {s.reconnecting}
                    </p>
                )}
            </section>

            <section className="flex flex-col gap-2 rounded-lg border p-3 text-center">
                <p className="text-body text-foreground">
                    {fill(s.signedInToRoom, { room })} {s.notYou}
                </p>
                {confirmEnd ? (
                    <>
                        <p className="text-body text-foreground">{s.signOutPanelConfirm}</p>
                        <ActionButton onClick={end}>{s.signOutPanelYes}</ActionButton>
                        <ActionButton secondary onClick={() => setConfirmEnd(false)}>
                            {s.cancel}
                        </ActionButton>
                    </>
                ) : (
                    <ActionButton secondary onClick={() => setConfirmEnd(true)}>
                        {s.signOutPanel}
                    </ActionButton>
                )}
                {endFailed && (
                    <p role="alert" className="text-body text-danger-600">
                        {s.noConnection}
                    </p>
                )}
            </section>

            {instituteId && signedIn && <TodayList instituteId={instituteId} />}
            {instituteId && !signedIn && !showSignIn && (
                <ActionButton text onClick={() => setShowSignIn(true)}>
                    {s.signInForToday}
                </ActionButton>
            )}
            {instituteId && !signedIn && showSignIn && (
                <SignInForm instituteId={instituteId} instituteName={remote.instituteName} />
            )}
        </div>
    );
}
