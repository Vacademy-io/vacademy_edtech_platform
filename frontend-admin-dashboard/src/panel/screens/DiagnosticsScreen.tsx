/**
 * Diagnostics / compatibility screen (works signed out; first-run landing).
 *
 * Shows the browser engine vs PANEL_MIN_CHROME, the native WebView + device
 * (PanelDevice.getInfo in the APK), viewport / DPR / touch with a live
 * multi-touch counter, a feature table (incl. whether window.Promise is still
 * native — core-js would replace it at V8 66), backend reachability, the
 * default-Home status with settings shortcuts, build info, captured errors and
 * a QR of the whole report for support. "Continue" marks first run done. On a
 * paired panel it also shows the institute, room, short device id and last sync; no
 * token or secret is ever displayed. Once paired, Android settings and Switch Home
 * are for an admin of this institute, and Wi-Fi and Date appear when the panel is
 * offline or its date is wrong.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import QRCode from 'react-qr-code';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowClockwise, ArrowRight } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { DOMAIN_ROUTING_RESOLVE } from '@/constants/urls';
import { PANEL_MIN_CHROME, PANEL_STORAGE_KEYS } from '../config';
import { isPanelDateWrong } from '../device/activity';
import { getActivityStats } from '../device/activityLog';
import { getAppVersionCode } from '../device/deviceInfo';
import { useDeviceRecord } from '../device/store';
import { isPanelOffline, useSyncSnapshot } from '../device/syncLoop';
import { getAppChannelForSync, useUpdateState } from '../device/updateOffer';
import { canUseDeviceSettings, usePanelSession } from '../lib/session';
import { PanelTopBar } from '../components/PanelTopBar';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelEmpty, PanelLoading } from '../components/PanelScreenState';
import {
    getDeviceInfo,
    getWebDeviceInfo,
    isNativePanel,
    openDeviceSettings,
    type PanelSettingsTarget,
} from '../lib/native';
import { writeString } from '../lib/storage';
import { goBack, navigate, usePanelRoute } from '../router';

interface FeatureRow {
    key: string;
    ok: boolean;
    detail?: string;
}

function safe(test: () => boolean): boolean {
    try {
        return test();
    } catch {
        return false;
    }
}

function probeFeatures(): FeatureRow[] {
    const canvas = document.createElement('canvas');
    const rows: FeatureRow[] = [
        { key: 'pointerEvent', ok: typeof window.PointerEvent === 'function' },
        { key: 'resizeObserver', ok: typeof window.ResizeObserver === 'function' },
        { key: 'intersectionObserver', ok: typeof window.IntersectionObserver === 'function' },
        { key: 'webgl', ok: safe(() => !!canvas.getContext('webgl')) },
        { key: 'webgl2', ok: safe(() => !!document.createElement('canvas').getContext('webgl2')) },
        { key: 'abortController', ok: typeof window.AbortController === 'function' },
        { key: 'eventSource', ok: typeof window.EventSource === 'function' },
        { key: 'cryptoSubtle', ok: safe(() => !!window.crypto?.subtle) },
        {
            key: 'localStorage',
            ok: safe(() => {
                const probe = 'panel.diagnostics.probe';
                window.localStorage.setItem(probe, '1');
                const read = window.localStorage.getItem(probe) === '1';
                window.localStorage.removeItem(probe);
                return read;
            }),
        },
        {
            key: 'cookies',
            ok: safe(() => {
                document.cookie = 'panel_probe=1; path=/; SameSite=Lax';
                const read = document.cookie.indexOf('panel_probe=1') >= 0;
                document.cookie = 'panel_probe=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
                return read;
            }),
        },
        {
            key: 'nativePromise',
            ok: String(Promise).indexOf('[native code]') >= 0,
            detail: String(Promise).slice(0, 40),
        },
        { key: 'promiseAllSettled', ok: typeof Promise.allSettled === 'function' },
        { key: 'globalThis', ok: typeof globalThis === 'object' },
        { key: 'structuredClone', ok: typeof window.structuredClone === 'function' },
        { key: 'wasm', ok: typeof (window as { WebAssembly?: unknown }).WebAssembly === 'object' },
    ];
    return rows;
}

interface BackendResult {
    reachable: boolean;
    status: number | null;
    ms: number;
}

async function checkBackend(): Promise<BackendResult> {
    const started = performance.now();
    try {
        const response = await axios.get(DOMAIN_ROUTING_RESOLVE, {
            params: { domain: 'vacademy.io', subdomain: 'admin-app' },
            timeout: 8000,
            validateStatus: () => true,
        });
        return {
            reachable: true,
            status: response.status,
            ms: Math.round(performance.now() - started),
        };
    } catch {
        return { reachable: false, status: null, ms: Math.round(performance.now() - started) };
    }
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid grid-cols-5 gap-4 border-b border-border py-3 last:border-b-0">
            <dt className="col-span-2 text-subtitle text-neutral-500">{label}</dt>
            <dd className="col-span-3 break-all text-subtitle text-neutral-800">{children}</dd>
        </div>
    );
}

function Section({
    title,
    children,
    action,
}: {
    title: string;
    children: ReactNode;
    action?: ReactNode;
}) {
    return (
        <Card className="rounded-lg">
            <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-h3 font-semibold text-neutral-800">{title}</CardTitle>
                {action}
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

/** Live pointer counter: proves multi-touch (IR frames often report 1 or mouse). */
function TouchTestArea() {
    const { t } = useTranslation('panel');
    const active = useRef(new Map<number, string>());
    const [count, setCount] = useState(0);
    const [max, setMax] = useState(0);
    const [types, setTypes] = useState<string[]>([]);

    const update = () => {
        const size = active.current.size;
        setCount(size);
        setMax((previous) => Math.max(previous, size));
    };

    return (
        <div
            className="panel-touch-surface flex min-h-64 flex-col items-center justify-center space-y-2 rounded-lg border-2 border-dashed border-primary-300 bg-primary-50 p-6 text-center"
            onPointerDown={(event) => {
                active.current.set(event.pointerId, event.pointerType);
                const pointerType = event.pointerType || 'unknown';
                setTypes((previous) =>
                    previous.indexOf(pointerType) >= 0 ? previous : previous.concat(pointerType)
                );
                update();
            }}
            onPointerUp={(event) => {
                active.current.delete(event.pointerId);
                update();
            }}
            onPointerCancel={(event) => {
                active.current.delete(event.pointerId);
                update();
            }}
            onPointerLeave={(event) => {
                active.current.delete(event.pointerId);
                update();
            }}
        >
            <span className="text-h1 font-semibold text-primary-500">{count}</span>
            <span className="text-title text-neutral-600">{t('diagnostics.touchActive')}</span>
            <span className="text-subtitle text-neutral-500">
                {t('diagnostics.touchMax', { count: max })}
                {types.length ? ` · ${types.join(', ')}` : ''}
            </span>
            <span className="text-body text-neutral-500">{t('diagnostics.touchHint')}</span>
        </div>
    );
}

function chip(ok: boolean, text: string, warn = false): ReactNode {
    const status: StatusType = ok ? 'SUCCESS' : warn ? 'WARNING' : 'DANGER';
    // shrink-0 + break-normal: inside an InfoRow (break-all, flex row) a long value
    // squeezed the chip until "66" wrapped one digit per line (seen on panel_api28).
    return (
        <span className="shrink-0 break-normal">
            <StatusChip text={text} textSize="text-subtitle" status={status} />
        </span>
    );
}

/** Short enough to read out over the phone, and never the secret. */
function shortDeviceId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
}

/** Phase 2: the build's channel, the last update result and the activity queue. */
function PhaseTwoRows() {
    const { t } = useTranslation('panel');
    const last = useUpdateState().last;
    const channel = getAppChannelForSync();
    const activity = getActivityStats();
    return (
        <>
            {channel && <InfoRow label={t('update.diagChannel')}>{channel}</InfoRow>}
            {last && (
                <InfoRow label={t('update.diagLast')}>
                    {/* Raw codes on purpose: this row is for whoever supports the panel. */}
                    {[last.version_code, last.outcome, last.code].filter(Boolean).join(' · ')}
                </InfoRow>
            )}
            {activity.sessionId && (
                <InfoRow label={t('activity.diagLabel')}>
                    {t('activity.diagValue', {
                        queued: activity.queued,
                        dropped: activity.dropped,
                    })}
                </InfoRow>
            )}
        </>
    );
}

function PairingSection() {
    const { t } = useTranslation('device');
    const device = useDeviceRecord();
    const sync = useSyncSnapshot();
    if (!device) {
        return (
            <Section title={t('diagnostics.section')}>
                <PanelEmpty className="p-4" title={t('diagnostics.notPaired')} />
            </Section>
        );
    }
    const offline = isPanelOffline();
    const appVersion = getAppVersionCode();
    const ageS =
        sync.lastSyncAt === null
            ? null
            : Math.max(0, Math.round((Date.now() - sync.lastSyncAt) / 1000));
    let lastSync = t('diagnostics.never');
    if (ageS !== null) {
        lastSync =
            ageS < 120
                ? t('diagnostics.secondsAgo', { count: ageS })
                : t('diagnostics.minutesAgo', { count: Math.round(ageS / 60) });
    }
    const belowMinimum =
        appVersion !== null &&
        sync.minAppVersionCode !== null &&
        appVersion < sync.minAppVersionCode;
    return (
        <Section title={t('diagnostics.section')}>
            <dl>
                <InfoRow label={t('diagnostics.status')}>
                    {device.revoked_at
                        ? chip(false, t('diagnostics.statusRemoved'), true)
                        : offline
                          ? chip(false, t('diagnostics.statusOffline'), true)
                          : chip(true, t('diagnostics.statusOk'))}
                </InfoRow>
                <InfoRow label={t('diagnostics.institute')}>
                    {device.institute_name ?? device.institute_id}
                </InfoRow>
                <InfoRow label={t('diagnostics.room')}>{device.room_name ?? '—'}</InfoRow>
                <InfoRow label={t('diagnostics.deviceId')}>
                    {shortDeviceId(device.device_id)}
                </InfoRow>
                <InfoRow label={t('diagnostics.lastSync')}>{lastSync}</InfoRow>
                <InfoRow label={t('diagnostics.serverOffset')}>
                    {t('diagnostics.offsetValue', {
                        value: Math.round(sync.serverOffsetMs / 1000),
                    })}
                </InfoRow>
                {appVersion !== null && (
                    <InfoRow label={t('diagnostics.appVersion')}>
                        {belowMinimum
                            ? chip(
                                  false,
                                  t('diagnostics.appVersionWarning', {
                                      current: appVersion,
                                      min: sync.minAppVersionCode,
                                  }),
                                  true
                              )
                            : appVersion}
                    </InfoRow>
                )}
                <PhaseTwoRows />
            </dl>
        </Section>
    );
}

export default function DiagnosticsScreen() {
    const { t } = useTranslation('panel');
    usePanelSession();
    const { params } = usePanelRoute();
    const firstRun = params.firstRun === '1';
    const native = isNativePanel();
    const web = useMemo(getWebDeviceInfo, []);
    const features = useMemo(probeFeatures, []);
    const [errors, setErrors] = useState<string[]>(() => (window.__PANEL_ERRORS__ || []).slice());
    const env = window.__PANEL_ENV__;

    const device = useQuery({
        queryKey: ['panel-device-info'],
        queryFn: getDeviceInfo,
        enabled: native,
        staleTime: 0,
    });
    const backend = useQuery({
        queryKey: ['panel-backend-check'],
        queryFn: checkBackend,
        staleTime: 0,
        retry: 0,
    });

    useEffect(() => {
        const timer = window.setInterval(
            () => setErrors((window.__PANEL_ERRORS__ || []).slice()),
            3000
        );
        return () => window.clearInterval(timer);
    }, []);

    const adminSettings = canUseDeviceSettings();
    const networkSettings = adminSettings || isPanelOffline() || isPanelDateWrong();
    const settingsTargets: PanelSettingsTarget[] = [
        ...(adminSettings ? (['home', 'settings'] as PanelSettingsTarget[]) : []),
        ...(networkSettings ? (['wifi', 'date'] as PanelSettingsTarget[]) : []),
    ];

    const chromeOk = web.chromeMajor !== null && web.chromeMajor >= PANEL_MIN_CHROME;
    const info = device.data ?? null;

    const report = useMemo(
        () =>
            JSON.stringify({
                app: `${__PANEL_BUILD__.version}+${__PANEL_BUILD__.gitSha}`,
                chrome: web.chromeMajor,
                min: PANEL_MIN_CHROME,
                ua: web.userAgent.slice(0, 160),
                wv: info ? `${info.webViewPackage}@${info.webViewVersion}` : null,
                android: info ? `${info.release}/${info.sdkInt}` : null,
                device: info ? `${info.manufacturer} ${info.model} ${info.hardware}` : null,
                home: info ? info.isDefaultHome : null,
                vp: `${web.viewportWidth}x${web.viewportHeight}@${web.devicePixelRatio}`,
                touch: web.maxTouchPoints,
                missing: features.filter((row) => !row.ok).map((row) => row.key),
                api: backend.data ? `${backend.data.status ?? 'down'}/${backend.data.ms}ms` : null,
                errors: errors.slice(-3).map((text) => text.slice(0, 120)),
            }),
        [web, info, features, backend.data, errors]
    );

    const openSettings = async (target: PanelSettingsTarget) => {
        const ok = await openDeviceSettings(target);
        if (!ok) toast.error(t('home.settingsUnavailable'));
    };

    const finish = () => {
        writeString(PANEL_STORAGE_KEYS.firstRunDone, new Date().toISOString());
        navigate('home', undefined, { replace: true });
    };

    const continueButton = (
        <MyButton buttonType="primary" scale="large" className="h-16 px-8" onClick={finish}>
            <span className="flex items-center space-x-2">
                <span>{t('common.continue')}</span>
                <ArrowRight size={28} aria-hidden />
            </span>
        </MyButton>
    );

    return (
        <PanelStage>
            <PanelTopBar
                title={t('diagnostics.title')}
                onBack={firstRun ? undefined : goBack}
                showHome={!firstRun}
                actions={continueButton}
            />
            <PanelStageBody className="p-8">
                <div className="mx-auto max-w-screen-2xl space-y-6">
                    {firstRun && (
                        <p className="rounded-lg border border-info-200 bg-info-50 p-4 text-title text-info-700">
                            {t('diagnostics.firstRunNote')}
                        </p>
                    )}
                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <PairingSection />
                        <Section title={t('diagnostics.sections.browser')}>
                            <dl>
                                <InfoRow label={t('diagnostics.chrome')}>
                                    <span className="flex items-center space-x-3">
                                        <span>
                                            {web.chromeMajor ?? t('diagnostics.unknown')} /{' '}
                                            {t('diagnostics.needs', { min: PANEL_MIN_CHROME })}
                                        </span>
                                        {chip(
                                            chromeOk,
                                            chromeOk ? t('diagnostics.ok') : t('diagnostics.tooOld')
                                        )}
                                    </span>
                                </InfoRow>
                                <InfoRow label={t('diagnostics.userAgent')}>
                                    {web.userAgent}
                                </InfoRow>
                                <InfoRow label={t('diagnostics.classroomShell')}>
                                    {web.classroomUserAgent
                                        ? t('diagnostics.yes')
                                        : t('diagnostics.no')}
                                </InfoRow>
                                <InfoRow label={t('diagnostics.viewport')}>
                                    {web.viewportWidth} × {web.viewportHeight} · DPR{' '}
                                    {web.devicePixelRatio}
                                </InfoRow>
                                <InfoRow label={t('diagnostics.screen')}>
                                    {web.screenWidth} × {web.screenHeight}
                                </InfoRow>
                                <InfoRow label={t('diagnostics.touchPoints')}>
                                    {web.maxTouchPoints}
                                </InfoRow>
                                <InfoRow label={t('diagnostics.build')}>
                                    {__PANEL_BUILD__.version} · {__PANEL_BUILD__.gitSha} ·{' '}
                                    {__PANEL_BUILD__.target} · {__PANEL_BUILD__.builtAt}
                                </InfoRow>
                                {env && (
                                    <InfoRow label={t('diagnostics.preflight')}>
                                        {env.missing.length
                                            ? env.missing.join(', ')
                                            : t('diagnostics.preflightOk')}
                                    </InfoRow>
                                )}
                            </dl>
                        </Section>

                        <Section title={t('diagnostics.sections.device')}>
                            {!native ? (
                                <PanelEmpty
                                    className="p-4"
                                    title={t('diagnostics.webOnlyTitle')}
                                    description={t('diagnostics.webOnlyBody')}
                                />
                            ) : device.isLoading ? (
                                <PanelLoading className="p-4" />
                            ) : !info ? (
                                <PanelEmpty
                                    className="p-4"
                                    title={t('diagnostics.deviceErrorTitle')}
                                    description={t('diagnostics.deviceErrorBody')}
                                    action={
                                        <MyButton
                                            buttonType="secondary"
                                            scale="large"
                                            className="h-16 px-8"
                                            onClick={() => void device.refetch()}
                                        >
                                            {t('common.retry')}
                                        </MyButton>
                                    }
                                />
                            ) : (
                                <dl>
                                    <InfoRow label={t('diagnostics.webView')}>
                                        <span className="flex items-center space-x-3">
                                            <span>
                                                {info.webViewPackage ?? '—'}{' '}
                                                {info.webViewVersion ?? ''}
                                            </span>
                                            {chip(
                                                info.webViewMajor >= PANEL_MIN_CHROME,
                                                String(info.webViewMajor)
                                            )}
                                        </span>
                                    </InfoRow>
                                    <InfoRow label={t('diagnostics.android')}>
                                        {info.release} (SDK {info.sdkInt})
                                    </InfoRow>
                                    <InfoRow label={t('diagnostics.model')}>
                                        {info.manufacturer} {info.brand} {info.model}
                                    </InfoRow>
                                    <InfoRow label={t('diagnostics.hardware')}>
                                        {info.board} · {info.hardware} · {info.abis.join(', ')}
                                    </InfoRow>
                                    <InfoRow label={t('diagnostics.memory')}>
                                        {info.totalRamMb} MB
                                    </InfoRow>
                                    <InfoRow label={t('diagnostics.display')}>
                                        {info.screenWidthPx} × {info.screenHeightPx} px ·{' '}
                                        {info.densityDpi} dpi
                                    </InfoRow>
                                    <InfoRow label={t('diagnostics.app')}>
                                        {info.appId} {info.appVersionName} ({info.appVersionCode})
                                    </InfoRow>
                                    <InfoRow label={t('diagnostics.defaultHome')}>
                                        {chip(
                                            info.isDefaultHome,
                                            info.isDefaultHome
                                                ? t('diagnostics.yes')
                                                : t('diagnostics.no'),
                                            true
                                        )}
                                    </InfoRow>
                                </dl>
                            )}
                            {native && settingsTargets.length > 0 && (
                                <div className="grid grid-cols-2 gap-4 pt-6">
                                    {settingsTargets.map((target) => (
                                        <MyButton
                                            key={target}
                                            buttonType="secondary"
                                            scale="large"
                                            className="h-16 w-full"
                                            onClick={() => void openSettings(target)}
                                        >
                                            {t(`diagnostics.open.${target}`)}
                                        </MyButton>
                                    ))}
                                </div>
                            )}
                        </Section>

                        <Section title={t('diagnostics.sections.touch')}>
                            <TouchTestArea />
                        </Section>

                        <Section title={t('diagnostics.sections.features')}>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {features.map((row) => (
                                    <div
                                        key={row.key}
                                        className="flex items-center justify-between space-x-3 rounded-md border border-border p-3"
                                    >
                                        <span className="text-subtitle text-neutral-700">
                                            {t(`diagnostics.features.${row.key}`)}
                                        </span>
                                        {chip(
                                            row.ok,
                                            row.ok ? t('diagnostics.ok') : t('diagnostics.missing')
                                        )}
                                    </div>
                                ))}
                            </div>
                        </Section>

                        <Section
                            title={t('diagnostics.sections.backend')}
                            action={
                                <MyButton
                                    buttonType="secondary"
                                    layoutVariant="icon"
                                    scale="large"
                                    className="size-14"
                                    aria-label={t('common.retry')}
                                    onClick={() => void backend.refetch()}
                                >
                                    <ArrowClockwise size={28} />
                                </MyButton>
                            }
                        >
                            {backend.isFetching ? (
                                <PanelLoading
                                    className="p-4"
                                    label={t('diagnostics.backendChecking')}
                                />
                            ) : backend.data ? (
                                <dl>
                                    <InfoRow label={t('diagnostics.backendStatus')}>
                                        {chip(
                                            backend.data.reachable &&
                                                backend.data.status !== null &&
                                                backend.data.status < 400,
                                            backend.data.reachable
                                                ? `HTTP ${backend.data.status}`
                                                : t('diagnostics.unreachable'),
                                            backend.data.reachable
                                        )}
                                    </InfoRow>
                                    <InfoRow label={t('diagnostics.latency')}>
                                        {backend.data.ms} ms
                                    </InfoRow>
                                    <InfoRow label={t('diagnostics.endpoint')}>
                                        {DOMAIN_ROUTING_RESOLVE}
                                    </InfoRow>
                                </dl>
                            ) : null}
                        </Section>

                        <Section
                            title={t('diagnostics.sections.errors')}
                            action={
                                <MyButton
                                    buttonType="secondary"
                                    scale="large"
                                    className="h-14 px-6"
                                    onClick={() => toast.success(t('diagnostics.testToastMessage'))}
                                >
                                    {t('diagnostics.testToast')}
                                </MyButton>
                            }
                        >
                            {errors.length === 0 ? (
                                <PanelEmpty className="p-4" title={t('diagnostics.noErrors')} />
                            ) : (
                                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border border-danger-200 bg-danger-50 p-4 text-body text-danger-700">
                                    {errors.slice(-20).join('\n')}
                                </pre>
                            )}
                        </Section>

                        <Section title={t('diagnostics.sections.report')}>
                            <div className="flex flex-col items-center space-y-4">
                                <div className="rounded-md bg-white p-4">
                                    <QRCode value={report} size={288} level="L" />
                                </div>
                                <p className="text-subtitle text-neutral-500">
                                    {t('diagnostics.reportHint')}
                                </p>
                            </div>
                        </Section>
                    </div>
                    <div className="flex justify-end pb-8">{continueButton}</div>
                </div>
            </PanelStageBody>
        </PanelStage>
    );
}
