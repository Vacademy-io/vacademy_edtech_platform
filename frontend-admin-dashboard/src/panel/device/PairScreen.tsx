/**
 * #/pair. Every state in the pairing table: code with QR and number, dimmed after an
 * hour, the claim waiting for one Confirm tap, offline, wrong date, disabled, and the
 * "removed from its institute" notice after DEVICE_REVOKED.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    CalendarX,
    HandTap,
    PencilLine,
    Stethoscope,
    WarningCircle,
    WifiHigh,
    WifiSlash,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { PanelLoading } from '../components/PanelScreenState';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelTopBar } from '../components/PanelTopBar';
import { clearStrayCookies } from '../lib/session';
import { getWebDeviceInfo, openDeviceSettings, type PanelSettingsTarget } from '../lib/native';
import { navigate } from '../router';
import { getCachedDeviceInfo, loadPanelDeviceInfo } from './deviceInfo';
import { formatCode } from './formatCode';
import { createPairingFlow, type PairingFlow, type PairView } from './pairingFlow';
import { useDeviceRecord } from './store';
import { useQrSize } from './useQrSize';

function PairActions({ wifi, date }: { wifi?: boolean; date?: boolean }) {
    const { t } = useTranslation('device');
    const openSettings = async (target: PanelSettingsTarget) => {
        const ok = await openDeviceSettings(target);
        if (!ok) toast.error(t('common.settingsUnavailable'));
    };
    return (
        <div className="flex flex-wrap items-center justify-center space-x-4">
            <MyButton
                buttonType="secondary"
                scale="large"
                className="h-16 px-6"
                onClick={() => navigate('whiteboard')}
            >
                <span className="flex items-center space-x-2">
                    <PencilLine size={28} aria-hidden />
                    <span>{t('common.whiteboard')}</span>
                </span>
            </MyButton>
            <MyButton
                buttonType="secondary"
                scale="large"
                className="h-16 px-6"
                onClick={() => navigate('diagnostics')}
            >
                <span className="flex items-center space-x-2">
                    <Stethoscope size={28} aria-hidden />
                    <span>{t('common.diagnostics')}</span>
                </span>
            </MyButton>
            {wifi && (
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="h-16 px-6"
                    onClick={() => void openSettings('wifi')}
                >
                    <span className="flex items-center space-x-2">
                        <WifiHigh size={28} aria-hidden />
                        <span>{t('common.wifi')}</span>
                    </span>
                </MyButton>
            )}
            {date && (
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="h-16 px-6"
                    onClick={() => void openSettings('date')}
                >
                    <span className="flex items-center space-x-2">
                        <CalendarX size={28} aria-hidden />
                        <span>{t('common.dateSettings')}</span>
                    </span>
                </MyButton>
            )}
        </div>
    );
}

function CodeState({ view }: { view: Extract<PairView, { view: 'code' }> }) {
    const { t } = useTranslation('device');
    const qrSize = useQrSize();
    const info = getCachedDeviceInfo();
    const version = info?.webViewVersion ?? String(getWebDeviceInfo().chromeMajor ?? '');
    return (
        <div className="flex items-center justify-center">
            <div className="m-4 shrink-0 rounded-lg bg-white p-4 shadow-sm">
                <QRCode value={view.qrUrl} size={qrSize} level="M" />
            </div>
            <div className="m-4 min-w-0 max-w-2xl space-y-4">
                <p className="text-title text-neutral-600">{t('pair.instructions')}</p>
                <div className="flex items-end space-x-8">
                    <div>
                        <p className="text-subtitle text-neutral-500">{t('pair.codeLabel')}</p>
                        <p className="text-h1 font-semibold tabular-nums text-neutral-800">
                            {formatCode(view.code)}
                        </p>
                    </div>
                    <div>
                        <p className="text-subtitle text-neutral-500">{t('pair.numberLabel')}</p>
                        <p className="text-h1 font-semibold tabular-nums text-primary-500">
                            {view.matchCode}
                        </p>
                    </div>
                </div>
                <p className="text-body text-neutral-500">
                    {info?.model
                        ? t('pair.reported', { model: info.model, version })
                        : t('pair.reportedNoModel', { version })}
                </p>
            </div>
        </div>
    );
}

function ClaimedState({
    view,
    flow,
}: {
    view: Extract<PairView, { view: 'claimed' }>;
    flow: PairingFlow;
}) {
    const { t } = useTranslation('device');
    const confirmRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        confirmRef.current?.focus();
    }, []);
    const { claim } = view;
    const values = {
        institute: claim.institute_name ?? t('pair.unknownInstitute'),
        room: claim.room?.name ?? '',
        name: claim.claimed_by_name ?? '',
    };
    return (
        <div className="mx-auto max-w-3xl space-y-6 text-center">
            <h2 className="text-h1 font-semibold text-neutral-800">{t('pair.confirmTitle')}</h2>
            <p className="text-title text-neutral-600">
                {claim.claimed_by_name
                    ? t('pair.confirmBody', values)
                    : t('pair.confirmBodyNoName', values)}
            </p>
            <div className="flex justify-center space-x-4 pt-2">
                <MyButton
                    ref={confirmRef}
                    buttonType="primary"
                    scale="large"
                    className="h-16 px-8"
                    onAsyncClick={() => flow.confirm(true)}
                >
                    {t('pair.confirm')}
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="h-16 px-8"
                    onAsyncClick={() => flow.confirm(false)}
                >
                    {t('pair.cancel')}
                </MyButton>
            </div>
        </div>
    );
}

function Notice({
    icon,
    title,
    body,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    body?: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="mx-auto flex max-w-3xl flex-col items-center space-y-4 text-center">
            {icon}
            <h2 className="text-h2 font-semibold text-neutral-800">{title}</h2>
            {body && <p className="text-title text-neutral-500">{body}</p>}
            {children && <div className="pt-2">{children}</div>}
        </div>
    );
}

export default function PairScreen() {
    const { t } = useTranslation('device');
    const device = useDeviceRecord();
    const removed = !!device?.revoked_at;
    const [continued, setContinued] = useState(false);
    const [view, setView] = useState<PairView>({ view: 'starting' });

    const flow = useMemo(
        () =>
            createPairingFlow({
                onView: setView,
                onPaired: () => {
                    clearStrayCookies();
                    navigate('home', undefined, { replace: true });
                },
                onConfirmFailed: () => toast.error(t('pair.confirmFailed')),
            }),
        [t]
    );

    const showRemoved = removed && !continued;

    useEffect(() => {
        void loadPanelDeviceInfo();
        if (showRemoved) return;
        flow.start();
        const onInput = () => flow.noteInput();
        window.addEventListener('pointerdown', onInput, { passive: true });
        window.addEventListener('keydown', onInput, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', onInput);
            window.removeEventListener('keydown', onInput);
            flow.stop();
        };
    }, [flow, showRemoved]);

    let body;
    if (showRemoved) {
        body = (
            <Notice
                icon={<WarningCircle size={64} className="text-warning-500" aria-hidden />}
                title={t('pair.removed')}
                body={t('pair.removedBody')}
            >
                <MyButton
                    buttonType="primary"
                    scale="large"
                    className="h-16 px-8"
                    onClick={() => setContinued(true)}
                >
                    {t('pair.continueWithCode')}
                </MyButton>
            </Notice>
        );
    } else if (view.view === 'starting') {
        body = <PanelLoading label={t('pair.starting')} />;
    } else if (view.view === 'code') {
        body = <CodeState view={view} />;
    } else if (view.view === 'claimed') {
        body = <ClaimedState view={view} flow={flow} />;
    } else if (view.view === 'dimmed') {
        body = (
            <Notice
                icon={<HandTap size={64} className="text-neutral-400" aria-hidden />}
                title={t('pair.dimmed')}
            />
        );
    } else if (view.view === 'offline') {
        body = (
            <Notice
                icon={<WifiSlash size={64} className="text-neutral-400" aria-hidden />}
                title={t('common.noInternet')}
            >
                <MyButton
                    buttonType="primary"
                    scale="large"
                    className="h-16 px-8"
                    onClick={() => flow.retry()}
                >
                    {t('common.retry')}
                </MyButton>
            </Notice>
        );
    } else if (view.view === 'wrongDate') {
        body = (
            <Notice
                icon={<CalendarX size={64} className="text-danger-500" aria-hidden />}
                title={t('common.wrongDateTitle')}
                body={t('common.wrongDateBody')}
            />
        );
    } else {
        body = (
            <Notice
                icon={<WarningCircle size={64} className="text-neutral-400" aria-hidden />}
                title={t('pair.disabled')}
            >
                <MyButton
                    buttonType="primary"
                    scale="large"
                    className="h-16 px-8"
                    onClick={() => flow.retry()}
                >
                    {t('common.retry')}
                </MyButton>
            </Notice>
        );
    }

    const claiming = view.view === 'claimed' && !showRemoved;
    return (
        <PanelStage>
            <PanelTopBar title={t('pair.title')} />
            <PanelStageBody className="flex flex-col items-center justify-center p-8">
                <div className="w-full">{body}</div>
                {!claiming && (
                    <div className="pt-8">
                        <PairActions
                            wifi={view.view === 'code' || view.view === 'offline'}
                            date={view.view === 'wrongDate'}
                        />
                    </div>
                )}
            </PanelStageBody>
        </PanelStage>
    );
}
