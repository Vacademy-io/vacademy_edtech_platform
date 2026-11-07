/**
 * Panel Home: big launch tiles. Whiteboard always works; Present (Volt) and
 * Lessons need a signed-in teacher; Diagnostics always. In the classroom APK
 * (PanelDevice available) two escape hatches open Android settings and the
 * Home-app chooser, so a panel that uses us as its launcher is never a dead end.
 */
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
import { PanelTopBar } from '../components/PanelTopBar';
import { PanelStage, PanelStageBody, PanelFullscreenButton } from '../components/PanelStage';
import { PanelTile } from '../components/PanelTile';
import { usePanelSession } from '../lib/session';
import { isNativePanel, openDeviceSettings, type PanelSettingsTarget } from '../lib/native';
import { navigate, type PanelScreen } from '../router';

export default function HomeScreen() {
    const { t } = useTranslation('panel');
    const { user, isSignedIn } = usePanelSession();
    const native = isNativePanel();

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

    const lockedLabel = isSignedIn ? undefined : t('home.signInToUse');

    return (
        <PanelStage>
            <PanelTopBar actions={<PanelFullscreenButton />} />
            <PanelStageBody className="p-8">
                <div className="mx-auto max-w-screen-2xl space-y-8">
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

                    <div className="grid grid-cols-2 gap-6 2xl:grid-cols-4">
                        <PanelTile
                            icon={PencilLine}
                            label={t('home.tiles.whiteboard')}
                            description={t('home.tiles.whiteboardHint')}
                            onClick={() => open('whiteboard', false)}
                        />
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
                        <PanelTile
                            icon={Stethoscope}
                            label={t('home.tiles.diagnostics')}
                            description={t('home.tiles.diagnosticsHint')}
                            onClick={() => navigate('diagnostics')}
                        />
                        {native && (
                            <PanelTile
                                icon={GearSix}
                                label={t('home.tiles.androidSettings')}
                                description={t('home.tiles.androidSettingsHint')}
                                onClick={() => void openSettings('settings')}
                            />
                        )}
                        {native && (
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
