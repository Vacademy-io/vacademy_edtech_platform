import { useEffect, useState } from 'react';
import {
    DeviceMobile,
    AndroidLogo,
    AppleLogo,
    WindowsLogo,
    ArrowSquareOut,
    ArrowsClockwise,
    CircleNotch,
    Info,
    Package,
    WarningOctagon,
    ArrowCircleUp,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MyButton } from '@/components/design-system/button';
import { StatusChip, StatusType } from '@/components/design-system/status-chips';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { APP_REGISTRY_STATUS } from '@/constants/urls';

// ─── Types (mirrors community_service's AppRegistration payload, via admin_core_service's
//      AppStatusResponse DTO) ───────────────────────────────────────────────────────────────

type Platform = 'ANDROID' | 'IOS' | 'WINDOWS' | 'MACOS';

/** Present only while the rejection is still worth acting on — see AppStatusMapper#rejection. */
interface Rejection {
    version: string;
    build: string;
    reason: string;
    submitted_at: string;
    decided_at: string;
}

/** The newest recorded build the store is not serving yet. */
interface PendingUpdate {
    version: string;
    build: string;
    status: string;
    release_notes: string;
    submitted_at: string;
    ota_status: string;
}

/** The JavaScript bundle an installed app pulls on launch — read live, not recorded by ops. */
interface OtaBundle {
    version: string;
    published_at: string;
    release_notes: string;
    min_native_version: string;
    force_update: boolean;
    shared_bundle: boolean;
}

interface PlatformStatus {
    platform: Platform;
    enabled: boolean;
    status: string;
    /** The Play package name / Apple bundle id / Windows package identity for THIS platform. */
    app_id?: string;
    /** "Closed testing", "TestFlight — external testers", "Production"… empty when not recorded. */
    track?: string;
    ota?: OtaBundle | null;
    store_url: string;
    current_version: string;
    current_build: string;
    released_at: string;
    last_synced_at: string;
    rejection?: Rejection | null;
    pending_update?: PendingUpdate | null;
    update_available?: boolean;
}

interface RegisteredApp {
    id: string;
    name: string;
    display_name: string;
    package_name: string;
    platforms: PlatformStatus[];
}

interface AppStatusResponse {
    institute_id: string;
    apps: RegisteredApp[];
}

// ─── Presentation helpers ───────────────────────────────────────────────────────────────────

function buildPlatformMeta(
    t: TFunction
): Record<Platform, { label: string; Icon: typeof AndroidLogo }> {
    return {
        ANDROID: { label: t('platforms.android'), Icon: AndroidLogo },
        IOS: { label: t('platforms.ios'), Icon: AppleLogo },
        WINDOWS: { label: t('platforms.windows'), Icon: WindowsLogo },
        MACOS: { label: t('platforms.macos'), Icon: AppleLogo },
    };
}

/** Store-status strings come from the health-check dashboard's StoreStatus enum. */
function statusTone(status: string): StatusType {
    switch (status) {
        case 'LIVE':
        case 'APPROVED':
            return 'SUCCESS';
        case 'REJECTED':
        case 'SUSPENDED':
        case 'REMOVED':
        case 'FAILED':
            return 'DANGER';
        case 'IN_REVIEW':
        case 'SUBMITTED':
        case 'BUILD_PROCESSING':
        case 'UPDATE_AVAILABLE':
            return 'WARNING';
        default:
            return 'INFO';
    }
}

/**
 * A track is not a status, so it never borrows the status palette's green. What it must not do is
 * let "Live" on a testing track read as publicly downloadable — so anything short of the public
 * track is tinted as a caution.
 */
function trackTone(track: string): StatusType {
    return /^(production|app store|mac app store)/i.test(track) ? 'INFO' : 'WARNING';
}

function statusLabel(status: string): string {
    return status
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * Registry dates are whatever ops typed — an ISO timestamp from a live store sync, a bare
 * `YYYY-MM-DD` from a hand-filled form, or nothing at all. Anything unparseable renders as the
 * raw string rather than "Invalid Date".
 */
export function formatRegistryDate(value: string | undefined | null): string {
    if (!value) return '';
    // A bare YYYY-MM-DD — what the ops dashboard's <input type="date"> produces for submitted /
    // reviewed / released dates — is parsed by Date as UTC midnight, so every viewer behind UTC
    // reads it as the day before. Ops typed a calendar date, not an instant; read it as one.
    const calendarDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const parsed = calendarDay
        ? new Date(Number(calendarDay[1]), Number(calendarDay[2]) - 1, Number(calendarDay[3]))
        : new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

/**
 * When the platform team's sync last reached the store for this platform.
 *
 * Only ever an ISO instant — it is stamped by the server, never typed — so unlike the registry's
 * hand-entered dates this one carries a time worth showing: the sweep runs several times a day,
 * and "checked at 06:10" answers "is this current?" in a way "checked on 31 Aug" does not.
 */
export function formatSyncedAt(value: string | undefined | null): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
    });
}

/** `v1.2.3 (45)`, skipping whichever half was never recorded. */
export function versionLabel(version: string, build: string): string {
    if (!version && !build) return '';
    if (!version) return `(${build})`;
    return build ? `${version} (${build})` : version;
}

// ─── Main Component ─────────────────────────────────────────────────────────────────────────

/**
 * Read-only view of this institute's registered apps and their store status, pulled from the
 * health-check dashboard's App Registration module (community_service's app_registration table)
 * via admin_core_service's institute-scoped proxy.
 *
 * Registration and status updates are ops-only, done by the platform team in health-check —
 * there is intentionally no edit affordance here. What this screen does own is the two questions
 * an institute actually asks once the status is not a plain "Live": why was it rejected, and
 * where is the update.
 */
export default function AppStatusSettings() {
    const { t } = useTranslation('settingsAppStatus');
    const instituteId = getInstituteId();
    const [data, setData] = useState<AppStatusResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const platformMeta = buildPlatformMeta(t);

    const fetchStatus = async () => {
        if (!instituteId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await authenticatedAxiosInstance.get<AppStatusResponse>(
                APP_REGISTRY_STATUS(instituteId)
            );
            setData(res.data);
        } catch (err) {
            console.error('[AppStatus] Failed to load app status', err);
            setError(t('errors.loadStatus'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (instituteId) fetchStatus();
    }, [instituteId]);

    const apps = data?.apps ?? [];

    return (
        <div className="max-w-3xl space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <DeviceMobile className="size-5 text-primary-500" />
                                {t('title')}
                            </CardTitle>
                            <CardDescription>{t('description')}</CardDescription>
                        </div>
                        <MyButton
                            id="app-status-refresh-btn"
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="icon"
                            onClick={fetchStatus}
                            disable={loading}
                            title={t('refreshStatus')}
                        >
                            {loading ? (
                                <CircleNotch className="size-4 animate-spin" />
                            ) : (
                                <ArrowsClockwise className="size-4" />
                            )}
                        </MyButton>
                    </div>
                </CardHeader>
            </Card>

            {error && (
                <Alert className="border-danger-400 bg-danger-100">
                    <Info className="size-4 text-danger-600" />
                    <AlertDescription className="text-danger-600">{error}</AlertDescription>
                </Alert>
            )}

            {!error && loading && !data && (
                <Card>
                    <CardContent className="flex items-center justify-center gap-2 py-10 text-neutral-500">
                        <CircleNotch className="size-4 animate-spin" />
                        {t('loading')}
                    </CardContent>
                </Card>
            )}

            {!error && !loading && data && apps.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                        <Package className="size-8 text-neutral-300" />
                        <p className="text-body font-semibold text-neutral-600">
                            {t('emptyState.title')}
                        </p>
                        <p className="max-w-sm text-caption text-neutral-500">
                            {t('emptyState.description')}
                        </p>
                    </CardContent>
                </Card>
            )}

            {apps.map((app) => (
                <Card key={app.id}>
                    <CardHeader>
                        <CardTitle className="text-body font-semibold">
                            {app.display_name || app.name || t('untitledApp')}
                        </CardTitle>
                        {app.package_name && (
                            <CardDescription className="font-mono text-caption">
                                {app.package_name}
                            </CardDescription>
                        )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {(app.platforms ?? []).length === 0 && (
                            <p className="text-caption text-neutral-500">{t('noPlatforms')}</p>
                        )}
                        {(app.platforms ?? []).map((p) => (
                            <PlatformRow
                                key={p.platform}
                                platform={p}
                                meta={platformMeta[p.platform]}
                                appPackageName={app.package_name}
                                t={t}
                            />
                        ))}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

// ─── Per-platform block ─────────────────────────────────────────────────────────────────────

function PlatformRow({
    platform: p,
    meta,
    appPackageName,
    t,
}: {
    platform: PlatformStatus;
    meta: { label: string; Icon: typeof AndroidLogo } | undefined;
    appPackageName: string;
    t: TFunction;
}) {
    // A platform key the backend added but this build doesn't know yet must not blank the page —
    // it renders under its own raw name with the generic device icon.
    const Icon = meta?.Icon ?? DeviceMobile;
    const label = meta?.label ?? p.platform ?? t('platforms.unknown');
    const live = versionLabel(p.current_version, p.current_build);
    const track = p.track?.trim();
    // The app-level heading already carries one id; repeating it on the Android row is noise. An
    // iOS bundle that differs from it is not — the same app ships under two different ids.
    const ownId = p.app_id?.trim() && p.app_id.trim() !== appPackageName ? p.app_id.trim() : '';
    const checkedAt = formatSyncedAt(p.last_synced_at);

    return (
        <div className="space-y-2 rounded-md border border-neutral-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Icon className="size-5 text-neutral-500" />
                    <div>
                        <span className="text-body font-medium text-neutral-600">{label}</span>
                        {ownId && (
                            <p className="font-mono text-caption text-neutral-400">{ownId}</p>
                        )}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {live && <span className="text-caption text-neutral-500">{live}</span>}
                    <StatusChip
                        text={statusLabel(p.status)}
                        textSize="text-caption"
                        status={statusTone(p.status)}
                    />
                    {track && (
                        <StatusChip
                            text={track}
                            textSize="text-caption"
                            status={trackTone(track)}
                            // The status chip beside this one carries the icon; the INFO icon is a
                            // cross, which next to the word "Production" reads as a failure.
                            showIcon={false}
                        />
                    )}
                    {p.store_url && (
                        <a
                            href={p.store_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-caption text-primary-500 hover:underline"
                        >
                            {t('viewInStore')}
                            <ArrowSquareOut className="size-3.5" />
                        </a>
                    )}
                </div>
            </div>

            {p.ota && <OtaNote ota={p.ota} t={t} />}

            {checkedAt && (
                <p className="text-caption text-neutral-400">
                    {t('lastCheckedOn', { date: checkedAt })}
                </p>
            )}

            {p.rejection && <RejectionNote rejection={p.rejection} t={t} />}
            {p.pending_update && <PendingUpdateNote update={p.pending_update} t={t} />}
            {!p.pending_update && p.update_available && (
                <p className="text-caption text-neutral-500">{t('update.availableGeneric')}</p>
            )}
        </div>
    );
}

function RejectionNote({ rejection, t }: { rejection: Rejection; t: TFunction }) {
    const version = versionLabel(rejection.version, rejection.build);
    const decidedOn = formatRegistryDate(rejection.decided_at);
    // Apple tells us when a submission went in but never when review decided against it, so for
    // the commonest rejection there is no decided date at all. Falling back to the submitted date
    // keeps the line from reading as a rejection with no history whatsoever.
    const submittedOn = decidedOn ? '' : formatRegistryDate(rejection.submitted_at);

    return (
        <div className="rounded-md border border-danger-400 bg-danger-100 p-3">
            <div className="flex items-center gap-2">
                <WarningOctagon className="size-4 shrink-0 text-danger-600" weight="fill" />
                <p className="text-caption font-semibold text-danger-600">{t('rejection.title')}</p>
            </div>
            <p className="mt-1 text-caption text-neutral-600">
                {version && <span className="font-mono">{version}</span>}
                {version && (decidedOn || submittedOn) && ' · '}
                {decidedOn && t('rejection.decidedOn', { date: decidedOn })}
                {submittedOn && t('rejection.submittedOn', { date: submittedOn })}
            </p>
            {rejection.reason ? (
                <p className="mt-2 whitespace-pre-wrap text-caption text-neutral-600">
                    <span className="font-semibold">{t('rejection.reasonLabel')}: </span>
                    {rejection.reason}
                </p>
            ) : (
                <p className="mt-2 text-caption text-neutral-500">{t('rejection.noReason')}</p>
            )}
        </div>
    );
}

function PendingUpdateNote({ update, t }: { update: PendingUpdate; t: TFunction }) {
    const version = versionLabel(update.version, update.build);
    const submittedOn = formatRegistryDate(update.submitted_at);

    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <ArrowCircleUp className="size-4 shrink-0 text-primary-500" />
                    <p className="text-caption font-semibold text-neutral-600">
                        {t('update.title')}
                    </p>
                </div>
                <StatusChip
                    text={statusLabel(update.status)}
                    textSize="text-caption"
                    status={statusTone(update.status)}
                />
            </div>
            <p className="mt-1 text-caption text-neutral-600">
                {version && <span className="font-mono">{version}</span>}
                {version && submittedOn && ' · '}
                {submittedOn && t('update.submittedOn', { date: submittedOn })}
            </p>
            {update.release_notes && (
                <p className="mt-2 whitespace-pre-wrap text-caption text-neutral-500">
                    <span className="font-semibold">{t('update.releaseNotes')}: </span>
                    {update.release_notes}
                </p>
            )}
        </div>
    );
}

/**
 * What the installed app is actually running.
 *
 * The store version is only the shell; this is the JavaScript inside it, shipped over the air and
 * moving on its own schedule — an app can sit on store version 1.0.4 for months while its bundle
 * changes weekly. Read live from the OTA registry rather than recorded by hand, which is why it is
 * the one line here that cannot be out of date.
 */
function OtaNote({ ota, t }: { ota: OtaBundle; t: TFunction }) {
    const publishedOn = formatRegistryDate(ota.published_at);
    // 1.0.0 is the default floor every bundle carries; saying it out loud would just be noise.
    const floor =
        ota.min_native_version && ota.min_native_version !== '1.0.0' ? ota.min_native_version : '';

    return (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-caption text-neutral-500">
            <span className="flex items-center gap-1 font-medium text-neutral-600">
                <Package className="size-3.5" />
                {t('ota.label')}
            </span>
            <span className="font-mono text-neutral-600">{ota.version}</span>
            {publishedOn && <span>{t('ota.publishedOn', { date: publishedOn })}</span>}
            {floor && <span>· {t('ota.minNativeVersion', { version: floor })}</span>}
            {ota.shared_bundle && (
                <span className="text-warning-600">· {t('ota.sharedBundle')}</span>
            )}
        </div>
    );
}
