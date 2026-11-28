/**
 * On top of every screen on a paired, signed-in panel: the saved-copy chip, and the lock
 * once a panel has been offline for too long. The lock lifts by itself if the next refresh
 * succeeds; if the server has ended the session, that sign-out returns the panel to the QR.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClockCounterClockwise, WifiSlash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { isBackendReachable, subscribeReachability } from '../device/publicApi';
import { signOut, usePanelSession } from '../lib/session';
import { navigate, usePanelRoute } from '../router';
import { offlineUseExpired } from './lock';
import { useShowingSavedCopy } from './savedCopy';

const LOCK_CHECK_MS = 15 * 1000;

function computeLocked(): boolean {
    return !isBackendReachable() && offlineUseExpired();
}

function useOfflineLocked(): boolean {
    const [locked, setLocked] = useState(computeLocked);
    useEffect(() => {
        const update = () => setLocked(computeLocked());
        update();
        const timer = window.setInterval(update, LOCK_CHECK_MS);
        const off = subscribeReachability(update);
        // Timers are paused while the device sleeps: look again as soon as it wakes.
        document.addEventListener('visibilitychange', update);
        return () => {
            window.clearInterval(timer);
            off();
            document.removeEventListener('visibilitychange', update);
        };
    }, []);
    return locked;
}

export default function OfflineLayer() {
    const { t } = useTranslation('offline');
    const { isSignedIn } = usePanelSession();
    const route = usePanelRoute();
    const locked = useOfflineLocked();
    const showingSaved = useShowingSavedCopy();
    const lockShown = isSignedIn && locked && route.screen !== 'diagnostics';
    const firstButton = useRef<HTMLButtonElement>(null);

    // Focus moves onto the lock, so a remote's OK cannot press a button hidden behind it.
    useEffect(() => {
        if (lockShown && firstButton.current) firstButton.current.focus();
    }, [lockShown]);

    if (!isSignedIn) return null;
    if (lockShown) {
        return (
            <div
                role="alert"
                data-panel-lock=""
                className="fixed inset-0 z-50 flex flex-col items-center justify-center space-y-6 bg-background p-8 text-center"
            >
                <WifiSlash size={72} className="text-danger-500" aria-hidden />
                <h1 className="text-h1 font-semibold text-neutral-800">{t('lock.title')}</h1>
                <p className="max-w-2xl text-h3 text-neutral-600">{t('lock.body')}</p>
                <div className="flex items-center space-x-4">
                    <MyButton
                        ref={firstButton}
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-8"
                        onClick={() => navigate('diagnostics')}
                    >
                        {t('lock.diagnostics')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="large"
                        className="h-16 px-8"
                        onAsyncClick={async () => {
                            await signOut();
                            navigate('home', undefined, { replace: true });
                        }}
                    >
                        {t('lock.signOut')}
                    </MyButton>
                </div>
            </div>
        );
    }
    if (!showingSaved) return null;
    return (
        <div
            role="status"
            className="pointer-events-none fixed right-4 top-24 z-40 flex h-12 items-center space-x-2 rounded-full border border-border bg-card px-4 text-subtitle text-neutral-700 shadow-sm"
        >
            <ClockCounterClockwise size={24} className="shrink-0 text-warning-600" aria-hidden />
            <span>{t('chip')}</span>
        </div>
    );
}
