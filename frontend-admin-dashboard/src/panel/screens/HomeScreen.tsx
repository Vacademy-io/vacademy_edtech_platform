/**
 * Panel Home.
 *
 * Signed in: Today's classes above the tiles. Signed out on a paired panel: the sign-in
 * QR with Whiteboard and Diagnostics beside it, and no class name anywhere. Lab builds
 * with no device behind them keep the Phase 0 tiles.
 *
 * Android settings and Switch Home open the way out of the app, so they stay for the
 * installer before pairing and afterwards only for an admin of this institute. Wi-Fi and
 * Date settings appear in the offline and wrong-date states of the card or the strip.
 *
 * The sign-in card and the strip are separate chunks, so neither weighs on first paint.
 */
import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    BookOpenText,
    GearSix,
    HouseLine,
    PencilLine,
    PresentationChart,
    SignIn,
    Stethoscope,
} from '@phosphor-icons/react';
import { clearTodayCache } from '../classes/todayCache';
import { TodaySkeleton } from '../classes/TodaySkeleton';
import { useArrowFocus } from '../classes/useArrowFocus';
import { PanelLoading } from '../components/PanelScreenState';
import { PanelTopBar } from '../components/PanelTopBar';
import { PanelStage, PanelStageBody, PanelFullscreenButton } from '../components/PanelStage';
import { PanelTile } from '../components/PanelTile';
import { subscribeDeviceEvents, useDeviceRecord, usesDeviceAuth } from '../device/store';
import { canUseDeviceSettings, usePanelSession } from '../lib/session';
import { isNativePanel, openDeviceSettings, type PanelSettingsTarget } from '../lib/native';
import { navigate, type PanelScreen } from '../router';

const TodayStrip = lazy(() => import('../classes/TodayStrip'));
const SignInCard = lazy(() =>
    import('../device/SignInCard').then((module) => ({ default: module.SignInCard }))
);

// A stored list belongs to one institute and to a panel that is still paired there.
subscribeDeviceEvents((event) => {
    if (event.type === 'REVOKED' || event.type === 'INSTITUTE_CHANGED') clearTodayCache();
});

export default function HomeScreen() {
    const { t } = useTranslation('panel');
    const { user, isSignedIn } = usePanelSession();
    const device = useDeviceRecord();
    const paired = usesDeviceAuth();
    const showDeviceSettings = isNativePanel() && canUseDeviceSettings();
    useArrowFocus();

    const open = (screen: PanelScreen, needsSignIn: boolean) => {
        if (needsSignIn && !isSignedIn) {
            navigate('login', { next: screen });
            return;
        }
        navigate(screen);
    };

    const openSettings = async (target: PanelSettingsTarget) => {
        const ok = await openDeviceSettings(target);
        if (!ok) toast.error(t('home.settingsUnavailable'));
    };

    const whiteboardTile = (className?: string) => (
        <PanelTile
            icon={PencilLine}
            label={t('home.tiles.whiteboard')}
            description={t('home.tiles.whiteboardHint')}
            onClick={() => open('whiteboard', false)}
            className={className}
        />
    );
    const diagnosticsTile = (className?: string) => (
        <PanelTile
            icon={Stethoscope}
            label={t('home.tiles.diagnostics')}
            description={t('home.tiles.diagnosticsHint')}
            onClick={() => navigate('diagnostics')}
            className={className}
        />
    );

    if (paired && !isSignedIn) {
        return (
            <PanelStage>
                <PanelTopBar actions={<PanelFullscreenButton />} />
                <PanelStageBody className="p-4">
                    <div className="mx-auto flex max-w-screen-2xl items-stretch">
                        <Suspense
                            fallback={
                                <div className="flex min-w-0 flex-1 items-center justify-center rounded-lg border border-border bg-card p-4">
                                    <PanelLoading />
                                </div>
                            }
                        >
                            <SignInCard
                                showActions={false}
                                className="flex min-w-0 flex-1 flex-col justify-center"
                            />
                        </Suspense>
                        <div className="ml-4 w-72 shrink-0 space-y-4">
                            {whiteboardTile('min-h-0 p-4')}
                            {diagnosticsTile('min-h-0 p-4')}
                        </div>
                    </div>
                </PanelStageBody>
            </PanelStage>
        );
    }

    const lockedLabel = isSignedIn ? undefined : t('home.signInToUse');

    return (
        <PanelStage>
            <PanelTopBar actions={<PanelFullscreenButton />} />
            <PanelStageBody className="p-6">
                <div className="mx-auto max-w-screen-2xl space-y-6">
                    {paired && device && user ? (
                        <Suspense fallback={<TodaySkeleton />}>
                            <TodayStrip
                                key={`${user.id}|${device.institute_id}`}
                                userId={user.id}
                                instituteId={device.institute_id}
                            />
                        </Suspense>
                    ) : (
                        <div className="space-y-1">
                            <h2 className="text-h1 font-semibold text-neutral-800">
                                {isSignedIn && user
                                    ? t('home.greeting', { name: user.fullName || user.username })
                                    : t('home.greetingSignedOut')}
                            </h2>
                            <p className="text-title text-neutral-500">
                                {isSignedIn ? t('home.subtitle') : t('home.subtitleSignedOut')}
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-6 2xl:grid-cols-4">
                        {whiteboardTile()}
                        <PanelTile
                            icon={PresentationChart}
                            label={t('home.tiles.volt')}
                            description={t('home.tiles.voltHint')}
                            lockedLabel={lockedLabel}
                            onClick={() => open('volt', true)}
                        />
                        <PanelTile
                            icon={BookOpenText}
                            label={t('home.tiles.lessons')}
                            description={t('home.tiles.lessonsHint')}
                            lockedLabel={lockedLabel}
                            onClick={() => open('lessons', true)}
                        />
                        {!isSignedIn && (
                            <PanelTile
                                icon={SignIn}
                                label={t('home.tiles.signIn')}
                                description={t('home.tiles.signInHint')}
                                onClick={() => navigate('login')}
                            />
                        )}
                        {diagnosticsTile()}
                        {showDeviceSettings && (
                            <PanelTile
                                icon={GearSix}
                                label={t('home.tiles.androidSettings')}
                                description={t('home.tiles.androidSettingsHint')}
                                onClick={() => void openSettings('settings')}
                            />
                        )}
                        {showDeviceSettings && (
                            <PanelTile
                                icon={HouseLine}
                                label={t('home.tiles.switchHome')}
                                description={t('home.tiles.switchHomeHint')}
                                onClick={() => void openSettings('home')}
                            />
                        )}
                    </div>
                </div>
            </PanelStageBody>
        </PanelStage>
    );
}
