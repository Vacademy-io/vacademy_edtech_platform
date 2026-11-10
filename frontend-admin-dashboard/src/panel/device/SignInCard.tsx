/**
 * The QR sign-in card, used on the signed-out Home and full-screen at #/signin.
 * Every state in the table: QR with no number, scanned with the number, approving,
 * dimmed, offline, wrong date, unavailable. No number shows before a scan, so a
 * photo of the QR does not carry it. Phase 2 slots: the licence, awaiting and
 * updateRequired views, and the update bar while signed out.
 *
 *   <SignInCard onDone={...} />                       signed-out Home
 *   <SignInCard purpose="ATTACH_REMOTE" onDone=... /> Connect phone
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    CalendarX,
    Key,
    HandTap,
    PencilLine,
    Stethoscope,
    WarningCircle,
    WifiHigh,
    WifiSlash,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { PanelChallengePurpose } from '@/classroom-shared/apiTypes';
import { PanelLoading } from '../components/PanelScreenState';
import { openDeviceSettings, type PanelSettingsTarget } from '../lib/native';
import { navigate } from '../router';
import { formatCode } from './formatCode';
import { LicenceGraceChip } from './LicenceGraceChip';
import {
    createSignInFlow,
    type SignInFlow,
    type SignInOutcome,
    type SignInView,
} from './signInFlow';
import { useDeviceRecord } from './store';
import { UpdateBar } from './UpdateBar';
import { useQrSize } from './useQrSize';

// Shown only when a sign-in is refused: kept out of the first load.
const LicenceCard = lazy(() =>
    import('./refusedViews').then((module) => ({ default: module.LicenceCard }))
);
const AwaitingCard = lazy(() =>
    import('./refusedViews').then((module) => ({ default: module.AwaitingCard }))
);
const UpdateRequiredCard = lazy(() =>
    import('./refusedViews').then((module) => ({ default: module.UpdateRequiredCard }))
);

export interface SignInCardProps {
    purpose?: PanelChallengePurpose;
    /** Called when a teacher signed in, a phone attached, or the session ended under the card. */
    onDone?: (outcome: SignInOutcome) => void;
    /** Whiteboard and Diagnostics buttons. Off where the page has its own (Home tiles). */
    showActions?: boolean;
    className?: string;
}

function hostOf(url: string | null | undefined): string {
    const match = url ? /^https?:\/\/([^/#?]+)/.exec(url) : null;
    return match?.[1] ?? '';
}

function ActionButton({
    icon,
    label,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
}) {
    return (
        <MyButton buttonType="secondary" scale="large" className="h-16 px-6" onClick={onClick}>
            <span className="flex items-center space-x-2">
                {icon}
                <span>{label}</span>
            </span>
        </MyButton>
    );
}

export function SignInCard({
    purpose = 'SIGN_IN',
    onDone,
    showActions = true,
    className,
}: SignInCardProps) {
    const { t } = useTranslation('device');
    const device = useDeviceRecord();
    const qrSize = useQrSize();
    const [view, setView] = useState<SignInView>({ view: 'starting' });
    const onDoneRef = useRef(onDone);
    onDoneRef.current = onDone;
    const flow: SignInFlow = useMemo(
        () =>
            createSignInFlow({
                purpose,
                onView: setView,
                onDone: (outcome) => onDoneRef.current?.(outcome),
                onNumberDead: () => toast.error(t('signIn.numberDead')),
            }),
        [purpose, t]
    );

    useEffect(() => {
        flow.start();
        const onInput = () => flow.noteInput();
        window.addEventListener('pointerdown', onInput, { passive: true });
        window.addEventListener('keydown', onInput, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', onInput);
            window.removeEventListener('keydown', onInput);
            flow.stop();
        };
    }, [flow]);

    const openSettings = async (target: PanelSettingsTarget) => {
        const ok = await openDeviceSettings(target);
        if (!ok) toast.error(t('common.settingsUnavailable'));
    };

    const place =
        device?.room_name && device.institute_name
            ? t('signIn.place', { room: device.room_name, institute: device.institute_name })
            : device?.room_name ?? device?.institute_name ?? '';
    const host = hostOf(device?.approve_base_url) || (view.view === 'qr' ? hostOf(view.qrUrl) : '');

    let body;
    switch (view.view) {
        case 'starting':
            body = <PanelLoading label={t('signIn.starting')} />;
            break;
        case 'approving':
            body = <PanelLoading label={t('signIn.approving')} />;
            break;
        case 'qr':
            body = (
                <div className="flex items-center justify-center">
                    <div className="m-4 shrink-0 rounded-lg bg-white p-4 shadow-sm">
                        <QRCode value={view.qrUrl} size={qrSize} level="M" />
                    </div>
                    <div className="m-4 min-w-0 max-w-xl space-y-4">
                        {place && <p className="text-h2 font-semibold text-neutral-800">{place}</p>}
                        <p className="text-title text-neutral-600">
                            {purpose === 'ATTACH_REMOTE'
                                ? t('signIn.attachScan')
                                : t('signIn.scan')}
                        </p>
                        <p className="text-subtitle text-neutral-500">
                            {t('signIn.cantScan', { host, code: formatCode(view.userCode) })}
                        </p>
                    </div>
                </div>
            );
            break;
        case 'scanned':
            body = (
                <div className="flex flex-col items-center space-y-4 p-8 text-center">
                    <p className="text-h2 font-semibold text-neutral-800">
                        {view.name
                            ? t('signIn.confirmingName', { name: view.name })
                            : t('signIn.confirmingNoName')}
                    </p>
                    <p className="text-title text-neutral-600">{t('signIn.tapNumber')}</p>
                    <p className="origin-center scale-150 py-6 text-h1 font-semibold tabular-nums text-primary-500">
                        {view.matchCode}
                    </p>
                </div>
            );
            break;
        case 'dimmed':
            body = (
                <div className="flex flex-col items-center space-y-4 p-12 text-center">
                    <HandTap size={64} className="text-neutral-400" aria-hidden />
                    <p className="text-h2 text-neutral-700">{t('signIn.dimmed')}</p>
                </div>
            );
            break;
        case 'offline':
            body = (
                <div className="flex flex-col items-center space-y-4 p-8 text-center">
                    <WifiSlash size={64} className="text-neutral-400" aria-hidden />
                    <p className="text-h2 text-neutral-700">{t('common.noInternet')}</p>
                    <div className="flex justify-center space-x-4 pt-2">
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            className="h-16 px-8"
                            onClick={() => flow.retry()}
                        >
                            {t('common.retry')}
                        </MyButton>
                        <ActionButton
                            icon={<WifiHigh size={28} aria-hidden />}
                            label={t('common.wifi')}
                            onClick={() => void openSettings('wifi')}
                        />
                    </div>
                </div>
            );
            break;
        case 'wrongDate':
            body = (
                <div className="flex flex-col items-center space-y-4 p-8 text-center">
                    <CalendarX size={64} className="text-danger-500" aria-hidden />
                    <p className="text-h2 text-neutral-700">{t('common.wrongDateTitle')}</p>
                    <p className="text-title text-neutral-500">{t('common.wrongDateBody')}</p>
                    <div className="pt-2">
                        <ActionButton
                            icon={<CalendarX size={28} aria-hidden />}
                            label={t('common.dateSettings')}
                            onClick={() => void openSettings('date')}
                        />
                    </div>
                </div>
            );
            break;
        case 'unavailable':
            body = (
                <div className="flex flex-col items-center space-y-4 p-8 text-center">
                    <WarningCircle size={64} className="text-neutral-400" aria-hidden />
                    <p className="text-h2 text-neutral-700">{t('signIn.unavailable')}</p>
                    <div className="pt-2">
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            className="h-16 px-8"
                            onClick={() => flow.retry()}
                        >
                            {t('common.retry')}
                        </MyButton>
                    </div>
                </div>
            );
            break;
        case 'licence':
            body = (
                <Suspense fallback={<PanelLoading />}>
                    <LicenceCard onRetry={() => flow.retry()} />
                </Suspense>
            );
            break;
        case 'awaiting':
            body = (
                <Suspense fallback={<PanelLoading />}>
                    <AwaitingCard onRetry={() => flow.retry()} />
                </Suspense>
            );
            break;
        case 'updateRequired':
            body = (
                <Suspense fallback={<PanelLoading />}>
                    <UpdateRequiredCard onRetry={() => flow.retry()} />
                </Suspense>
            );
            break;
    }

    const passwordAllowed =
        purpose === 'SIGN_IN' &&
        !!device?.password_login_allowed &&
        (view.view === 'qr' || view.view === 'offline' || view.view === 'unavailable');

    return (
        <section className={cn('rounded-lg border border-border bg-card p-4', className)}>
            {body}
            {purpose === 'SIGN_IN' && view.view !== 'licence' && <LicenceGraceChip />}
            {purpose === 'SIGN_IN' && view.view !== 'updateRequired' && (
                <UpdateBar placement="signin" />
            )}
            {(showActions || passwordAllowed) && (
                <div className="flex flex-wrap items-center justify-center space-x-4 pt-4">
                    {showActions && (
                        <ActionButton
                            icon={<PencilLine size={28} aria-hidden />}
                            label={t('common.whiteboard')}
                            onClick={() => navigate('whiteboard')}
                        />
                    )}
                    {showActions && (
                        <ActionButton
                            icon={<Stethoscope size={28} aria-hidden />}
                            label={t('common.diagnostics')}
                            onClick={() => navigate('diagnostics')}
                        />
                    )}
                    {passwordAllowed && (
                        <ActionButton
                            icon={<Key size={28} aria-hidden />}
                            label={t('signIn.usePassword')}
                            onClick={() => navigate('signin', { mode: 'password' })}
                        />
                    )}
                </div>
            )}
        </section>
    );
}
