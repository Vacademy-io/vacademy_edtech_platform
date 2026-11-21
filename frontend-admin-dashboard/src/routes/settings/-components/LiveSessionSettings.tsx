import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
    VideoCamera,
    ChatTeardrop,
    ArrowsClockwise,
    CursorClick,
    Globe,
    ClipboardText,
    Article,
    FileText,
    Door,
    Broadcast,
    BellRinging,
    MonitorPlay,
    PlugsConnected,
    UserCheck,
    EyeSlash,
} from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { MyInput } from '@/components/design-system/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { DashboardLoader } from '@/components/core/dashboard-loader';

import {
    DEFAULT_LIVE_SESSION_SETTINGS,
    type LiveSessionSettings as LiveSessionSettingsType,
    type LiveSessionGuestPolicy,
    type ZoomApprovalType,
    type ZoomAudioOption,
    type ZoomAutoRecordingOption,
    PLATFORM_KEYS,
    type PlatformKey,
    getLiveSessionSettings,
    saveLiveSessionSettings,
} from '@/services/live-session-settings';
import { LIVE_SESSION_SETTINGS_QUERY_KEY } from '@/hooks/useLiveSessionSettings';
import {
    buildTimezoneOptions,
    buildWaitingRoomOptions,
    buildWaitingRoomTypeOptions,
} from '@/routes/study-library/live-session/schedule/-constants/options';
import { WaitingRoomType } from '@/routes/study-library/live-session/-constants/enums';
import { ZoomIntegrationCard } from './zoom/ZoomIntegrationCard';
import { GoogleMeetIntegrationCard } from './google/GoogleMeetIntegrationCard';
import { listGoogleAccounts, updateGoogleAccountSettings } from '@/services/google-accounts';
import { DefaultRecordingDestinationPicker } from './DefaultRecordingDestinationPicker';
import { LiveSessionVisibilityCard } from './LiveSessionVisibilityCard';
import { getInstituteId } from '@/constants/helper';

// Maps each platform key to its translation-catalog key (the JSON key can't
// hold a literal space, so 'google meet' -> 'googleMeet').
const PLATFORM_LABEL_KEYS: Record<PlatformKey, string> = {
    youtube: 'youtube',
    'google meet': 'googleMeet',
    zoom: 'zoom',
    zoho: 'zoho',
    bbb: 'bbb',
    other: 'other',
};

// Sentinel used for the "no reminder" option, because Radix Select can't hold
// an empty-string value. Mapped back to '' when read/written.
const NO_REMINDER = '__none__';
// Reminder offsets mirror the scheduling forms' TimeOptions so the default
// picked here is one the per-class UI can render.
const REMINDER_OPTION_VALUES = ['5m', '10m', '30m', '1h'] as const;

const SettingRow = ({
    title,
    description,
    checked,
    onChange,
    disabled,
    disabledReason,
}: {
    title: string;
    description: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    disabledReason?: string;
}) => (
    <div className="flex items-start justify-between gap-4 py-3">
        <div className="flex-1">
            <div className="text-sm font-medium text-neutral-800">{title}</div>
            <div className="mt-0.5 text-xs text-neutral-500">{description}</div>
            {disabled && disabledReason && (
                <div className="mt-1 text-xs text-amber-600">{disabledReason}</div>
            )}
        </div>
        <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
);

interface LiveSessionSettingsProps {
    /** Rendered inside the quick-access popup rather than the full /settings page. */
    embedded?: boolean;
}

export default function LiveSessionSettings({ embedded = false }: LiveSessionSettingsProps = {}) {
    const { t } = useTranslation('settingsLiveSession');
    // These option lists carry translated labels, so they are built from the
    // shared options namespace instead of being module-level constants.
    const { t: tOptions } = useTranslation('studyLibraryOptions');
    const TIMEZONE_OPTIONS = buildTimezoneOptions(tOptions);
    const WAITING_ROOM_OPTIONS = buildWaitingRoomOptions(tOptions);
    const WAITING_ROOM_TYPE_OPTIONS = buildWaitingRoomTypeOptions(tOptions);
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<LiveSessionSettingsType>(
        DEFAULT_LIVE_SESSION_SETTINGS
    );
    const [initial, setInitial] = useState<LiveSessionSettingsType>(DEFAULT_LIVE_SESSION_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // Google Meet auto-record lives on each connected Google account (not in this settings
    // document). Unsaved switch changes are kept here, keyed by account id, and written with
    // the rest of the page on Save.
    const { data: googleAccounts = [], isSuccess: googleAccountsLoaded } = useQuery({
        queryKey: ['google-accounts'],
        queryFn: listGoogleAccounts,
        retry: false,
    });
    const activeGoogleAccounts = googleAccounts.filter((a) => a.status === 'ACTIVE');
    const [googleRecordDrafts, setGoogleRecordDrafts] = useState<Record<string, boolean>>({});

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                const fresh = await getLiveSessionSettings();
                if (cancelled) return;
                setSettings(fresh);
                setInitial(fresh);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const dirty =
        JSON.stringify(settings) !== JSON.stringify(initial) ||
        Object.keys(googleRecordDrafts).length > 0;

    const setGoogleRecordDraft = (accountId: string, saved: boolean, next: boolean) => {
        setGoogleRecordDrafts((prev) => {
            const rest = { ...prev };
            delete rest[accountId];
            return next === saved ? rest : { ...rest, [accountId]: next };
        });
    };

    const togglePlatform = (key: PlatformKey, allowed: boolean) => {
        setSettings((prev) => {
            const allowedPlatforms = { ...prev.allowedPlatforms, [key]: allowed };
            let defaultPlatform = prev.defaultPlatform;
            // The default platform must always be an allowed one. If the admin
            // just hid the current default, fall back to the first platform
            // that's still allowed so the default never points at a hidden one.
            if (!allowed && key === defaultPlatform) {
                const nextAllowed = PLATFORM_KEYS.find((k) => allowedPlatforms[k] !== false);
                if (nextAllowed) defaultPlatform = nextAllowed;
            }
            return { ...prev, allowedPlatforms, defaultPlatform };
        });
    };

    const togglePrimitive = (key: keyof LiveSessionSettingsType, value: boolean) => {
        setSettings((prev) => ({ ...prev, [key]: value }) as LiveSessionSettingsType);
    };

    const toggleLmsConnection = (
        key: keyof LiveSessionSettingsType['lmsConnection'],
        value: boolean
    ) => {
        setSettings((prev) => ({
            ...prev,
            lmsConnection: { ...prev.lmsConnection, [key]: value },
        }));
    };

    const reset = () => {
        setSettings(initial);
        setGoogleRecordDrafts({});
    };

    const save = async () => {
        // Single/Bulk schedule entry-point visibility is now configured
        // per-role under Display Settings, so the institute-wide guard is
        // no longer needed here.
        // Guard: at least one platform must remain allowed.
        const anyPlatform = Object.values(settings.allowedPlatforms).some(Boolean);
        if (!anyPlatform) {
            toast.error(t('toast.atLeastOnePlatform'));
            return;
        }
        // Defensive: never persist a default platform that isn't allowed.
        let toSave = settings;
        if (settings.allowedPlatforms[settings.defaultPlatform] === false) {
            const fallback = PLATFORM_KEYS.find((k) => settings.allowedPlatforms[k] !== false);
            if (fallback) toSave = { ...settings, defaultPlatform: fallback };
        }
        try {
            setSaving(true);
            await saveLiveSessionSettings(toSave);
            // Reflect the (possibly corrected) saved document in local state so
            // the form and the dirty check stay in sync with what's persisted.
            setSettings(toSave);
            setInitial(toSave);
            await queryClient.invalidateQueries({ queryKey: LIVE_SESSION_SETTINGS_QUERY_KEY });
            // The settings document is saved by now; the Google accounts are separate writes.
            // Keep only the drafts that failed so a retry re-sends just those.
            const recordChanges = Object.entries(googleRecordDrafts);
            if (recordChanges.length > 0) {
                const results = await Promise.allSettled(
                    recordChanges.map(([id, recordingEnabled]) =>
                        updateGoogleAccountSettings(id, { recordingEnabled })
                    )
                );
                const failed = Object.fromEntries(
                    recordChanges.filter((_, i) => results[i]?.status === 'rejected')
                );
                setGoogleRecordDrafts(failed);
                await queryClient.invalidateQueries({ queryKey: ['google-accounts'] });
                if (Object.keys(failed).length > 0) {
                    toast.error(t('toast.googleAutoRecordSaveFailed'));
                    return;
                }
            }
            toast.success(t('toast.saveSuccess'));
        } catch (err) {
            console.error(err);
            toast.error(t('toast.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <DashboardLoader />
            </div>
        );
    }

    const platformAllowedCount = PLATFORM_KEYS.filter(
        (k) => settings.allowedPlatforms[k] !== false
    ).length;

    return (
        <div className="flex flex-col gap-5">
            <div
                className={cn(
                    'flex flex-wrap items-center gap-3',
                    embedded ? 'justify-end' : 'justify-between'
                )}
            >
                {!embedded && (
                    <div>
                        <h2 className="text-xl font-semibold text-neutral-800">
                            {t('header.title')}
                        </h2>
                        <p className="text-sm text-neutral-500">{t('header.description')}</p>
                    </div>
                )}
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={reset} disabled={!dirty || saving}>
                        {t('header.reset')}
                    </Button>
                    <Button
                        size="sm"
                        onClick={save}
                        disabled={!dirty || saving}
                        className="bg-primary-500 hover:bg-primary-600"
                    >
                        {saving ? t('header.saving') : t('header.saveChanges')}
                    </Button>
                </div>
            </div>

            {/* Default timezone */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <Globe size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('timezone.title')}</CardTitle>
                        <CardDescription>{t('timezone.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <Select
                            value={settings.defaultTimeZone || '__browser__'}
                            onValueChange={(v) =>
                                setSettings((prev) => ({
                                    ...prev,
                                    defaultTimeZone: v === '__browser__' ? '' : v,
                                }))
                            }
                        >
                            <SelectTrigger className="h-9 w-full sm:w-80">
                                <SelectValue placeholder={t('timezone.selectPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__browser__">
                                    {t('timezone.browserOption')}
                                </SelectItem>
                                {TIMEZONE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt._id} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-xs text-neutral-500">
                            {t('timezone.currently')}{' '}
                            <strong>
                                {settings.defaultTimeZone
                                    ? settings.defaultTimeZone
                                    : t('timezone.currentlyBrowser')}
                            </strong>
                        </span>
                    </div>
                </CardContent>
            </Card>

            {/* Streaming platforms */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <VideoCamera size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('platforms.title')}</CardTitle>
                        <CardDescription>{t('platforms.description')}</CardDescription>
                    </div>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                        {t('platforms.allowedCount', {
                            count: platformAllowedCount,
                            total: PLATFORM_KEYS.length,
                        })}
                    </span>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <div className="grid gap-1 sm:grid-cols-2">
                        {PLATFORM_KEYS.map((key) => {
                            const checked = settings.allowedPlatforms[key] !== false;
                            const isLastAllowed = checked && platformAllowedCount === 1;
                            return (
                                <div
                                    key={key}
                                    className={cn(
                                        'flex items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 transition-colors',
                                        checked
                                            ? 'bg-primary-50/40 hover:bg-primary-50/70'
                                            : 'hover:bg-neutral-50'
                                    )}
                                >
                                    <div>
                                        <div className="text-sm font-medium text-neutral-800">
                                            {t(`platformLabels.${PLATFORM_LABEL_KEYS[key]}`)}
                                        </div>
                                        <div className="text-xs text-neutral-500">{key}</div>
                                    </div>
                                    <Switch
                                        checked={checked}
                                        disabled={isLastAllowed}
                                        onCheckedChange={(v) => togglePlatform(key, v)}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* Default platform — pre-selected on new live classes. Only
                        allowed platforms are offered so the default can never
                        point at a hidden one. */}
                    <div className="mt-4 flex flex-col gap-1.5 border-t border-neutral-100 pt-4">
                        <span className="text-sm font-medium text-neutral-800">
                            {t('platforms.defaultPlatform')}
                        </span>
                        <span className="text-xs text-neutral-500">
                            {t('platforms.defaultPlatformDescription')}
                        </span>
                        <Select
                            value={settings.defaultPlatform}
                            onValueChange={(v) =>
                                setSettings((prev) => ({
                                    ...prev,
                                    defaultPlatform: v as PlatformKey,
                                }))
                            }
                        >
                            <SelectTrigger className="mt-1 h-9 w-full sm:w-80">
                                <SelectValue placeholder={t('platforms.selectDefaultPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {PLATFORM_KEYS.filter(
                                    (k) => settings.allowedPlatforms[k] !== false
                                ).map((k) => (
                                    <SelectItem key={k} value={k}>
                                        {t(`platformLabels.${PLATFORM_LABEL_KEYS[k]}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Zoom integration — multi-account credential management.
                Placed under the platform allow-list so the Zoom config sits right next
                to the toggle that allows the Zoom platform itself. */}
            <ZoomIntegrationCard />

            {/* Google Meet integration — per-tenant OAuth ("Connect Google Workspace"). */}
            <GoogleMeetIntegrationCard />

            {/* Recurring */}
            {/* Role-based session visibility. Additive: with nothing configured
                every role keeps seeing every session, exactly as before. */}
            <LiveSessionVisibilityCard
                instituteId={getInstituteId() ?? ''}
                value={settings.roleVisibility}
                onChange={(roleVisibility) => setSettings((prev) => ({ ...prev, roleVisibility }))}
            />

            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <ArrowsClockwise size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('recurring.title')}</CardTitle>
                        <CardDescription>{t('recurring.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('recurring.weeklyScheduleTitle')}
                        description={t('recurring.weeklyScheduleDescription')}
                        checked={settings.recurringEnabled}
                        onChange={(v) => togglePrimitive('recurringEnabled', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('recurring.defaultLinkTitle')}
                        description={t('recurring.defaultLinkDescription')}
                        checked={settings.defaultDayButtonEnabled}
                        onChange={(v) => togglePrimitive('defaultDayButtonEnabled', v)}
                        disabled={!settings.recurringEnabled}
                        disabledReason={
                            !settings.recurringEnabled
                                ? t('recurring.disabledBecauseWeeklyOff')
                                : undefined
                        }
                    />
                </CardContent>
            </Card>

            {/* Disclaimer video. Always available here — this is where an admin
                turns the feature on. While it is off, the per-class disclaimer
                control stays hidden on the live-class form. */}
            <Card className="border-neutral-200 shadow-none">
                    <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                        <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                            <ClipboardText size={18} />
                        </div>
                        <div className="flex-1">
                            <CardTitle className="text-base">{t('disclaimer.title')}</CardTitle>
                            <CardDescription>{t('disclaimer.description')}</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="border-t border-neutral-100 p-5">
                        <SettingRow
                            title={t('disclaimer.showBeforeJoinTitle')}
                            description={t('disclaimer.showBeforeJoinDescription')}
                            checked={settings.disclaimerVideoEnabled}
                            onChange={(v) => togglePrimitive('disclaimerVideoEnabled', v)}
                        />
                        <Separator />
                        <div className="py-4">
                            <div className="text-sm font-medium text-neutral-800">
                                {t('disclaimer.videoLinkLabel')}
                            </div>
                            <div className="mb-2 mt-0.5 text-caption text-neutral-500">
                                {t('disclaimer.videoLinkHint')}
                            </div>
                            <MyInput
                                inputType="text"
                                input={settings.disclaimerVideoUrl}
                                inputPlaceholder={t('disclaimer.videoLinkPlaceholder')}
                                onChangeFunction={(e) =>
                                    setSettings((prev) => ({
                                        ...prev,
                                        disclaimerVideoUrl: e.target.value,
                                    }))
                                }
                                disabled={!settings.disclaimerVideoEnabled}
                                className="w-full sm:w-96"
                            />
                            {settings.disclaimerVideoEnabled &&
                                !settings.disclaimerVideoUrl.trim() && (
                                    <div className="mt-1.5 text-caption text-warning-600">
                                        {t('disclaimer.noLinkWarning')}
                                    </div>
                                )}
                        </div>
                </CardContent>
            </Card>

            {/* Attendance-only mode: classes exist only to record offline
                attendance, so learners see their attendance but no classes. */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <EyeSlash size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('attendanceOnly.title')}</CardTitle>
                        <CardDescription>{t('attendanceOnly.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('attendanceOnly.toggleTitle')}
                        description={t('attendanceOnly.toggleDescription')}
                        checked={settings.attendanceOnlyMode}
                        onChange={(v) => togglePrimitive('attendanceOnlyMode', v)}
                    />
                    {settings.attendanceOnlyMode && (
                        <div className="mt-1 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-caption text-warning-700">
                            {t('attendanceOnly.onWarning')}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Daily attendance default */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <ClipboardText size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('attendanceDefault.title')}</CardTitle>
                        <CardDescription>{t('attendanceDefault.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('attendanceDefault.countByDefaultTitle')}
                        description={t('attendanceDefault.countByDefaultDescription')}
                        checked={settings.defaultDailyAttendanceCounting}
                        onChange={(v) => togglePrimitive('defaultDailyAttendanceCounting', v)}
                        disabled={!settings.recurringEnabled}
                        disabledReason={
                            !settings.recurringEnabled
                                ? t('recurring.disabledBecauseWeeklyOff')
                                : undefined
                        }
                    />
                </CardContent>
            </Card>

            {/* Description visibility */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <Article size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('description.title')}</CardTitle>
                        <CardDescription>{t('description.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('description.showFieldTitle')}
                        description={t('description.showFieldDescription')}
                        checked={settings.descriptionEnabled}
                        onChange={(v) => togglePrimitive('descriptionEnabled', v)}
                    />
                </CardContent>
            </Card>

            {/* Feedback */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <ChatTeardrop size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('feedback.title')}</CardTitle>
                        <CardDescription>{t('feedback.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('feedback.afterClassTitle')}
                        description={t('feedback.afterClassDescription')}
                        checked={settings.feedbackEnabled}
                        onChange={(v) => togglePrimitive('feedbackEnabled', v)}
                    />
                    {settings.feedbackEnabled && (
                        <div className="mt-4 border-t border-neutral-100 pt-4">
                            <SettingRow
                                title={t('feedback.enableByDefaultTitle')}
                                description={t('feedback.enableByDefaultDescription')}
                                checked={settings.defaultFeedbackEnabled}
                                onChange={(v) => togglePrimitive('defaultFeedbackEnabled', v)}
                            />
                            <Separator />
                            <SettingRow
                                title={t('feedback.compulsoryByDefaultTitle')}
                                description={t('feedback.compulsoryByDefaultDescription')}
                                checked={settings.defaultFeedbackCompulsory}
                                onChange={(v) => togglePrimitive('defaultFeedbackCompulsory', v)}
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Waiting room defaults */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <Door size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('waitingRoom.title')}</CardTitle>
                        <CardDescription>{t('waitingRoom.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('waitingRoom.enableByDefaultTitle')}
                        description={t('waitingRoom.enableByDefaultDescription')}
                        checked={settings.defaultWaitingRoomEnabled}
                        onChange={(v) => togglePrimitive('defaultWaitingRoomEnabled', v)}
                    />
                    <Separator />
                    <div className="grid gap-4 pt-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium text-neutral-800">
                                {t('waitingRoom.typeLabel')}
                            </span>
                            <Select
                                value={settings.defaultWaitingRoomType}
                                onValueChange={(v) =>
                                    setSettings((prev) => ({
                                        ...prev,
                                        defaultWaitingRoomType: v as WaitingRoomType,
                                    }))
                                }
                            >
                                <SelectTrigger className="h-9 w-full">
                                    <SelectValue placeholder={t('waitingRoom.typePlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {WAITING_ROOM_TYPE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt._id} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium text-neutral-800">
                                {t('waitingRoom.openBeforeLabel')}
                            </span>
                            <Select
                                value={settings.defaultWaitingRoomTime}
                                onValueChange={(v) =>
                                    setSettings((prev) => ({
                                        ...prev,
                                        defaultWaitingRoomTime: v,
                                    }))
                                }
                            >
                                <SelectTrigger className="h-9 w-full">
                                    <SelectValue placeholder={t('waitingRoom.durationPlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {WAITING_ROOM_OPTIONS.map((opt) => (
                                        <SelectItem key={opt._id} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <p className="mt-3 text-xs text-neutral-500">{t('waitingRoom.footnote')}</p>
                </CardContent>
            </Card>

            {/* Vacademy Meet (BBB) recording & controls defaults */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <Broadcast size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('bbb.title')}</CardTitle>
                        <CardDescription>{t('bbb.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('bbb.recordByDefaultTitle')}
                        description={t('bbb.recordByDefaultDescription')}
                        checked={settings.defaultBbbRecordEnabled}
                        onChange={(v) => togglePrimitive('defaultBbbRecordEnabled', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('bbb.autoStartRecordingTitle')}
                        description={t('bbb.autoStartRecordingDescription')}
                        checked={settings.defaultBbbAutoStartRecording}
                        onChange={(v) => togglePrimitive('defaultBbbAutoStartRecording', v)}
                        disabled={!settings.defaultBbbRecordEnabled}
                        disabledReason={
                            !settings.defaultBbbRecordEnabled
                                ? t('bbb.disabledBecauseRecordingOff')
                                : undefined
                        }
                    />
                    <Separator />
                    <SettingRow
                        title={t('bbb.muteOnStartTitle')}
                        description={t('bbb.muteOnStartDescription')}
                        checked={settings.defaultBbbMuteOnStart}
                        onChange={(v) => togglePrimitive('defaultBbbMuteOnStart', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('bbb.webcamsOnlyModeratorTitle')}
                        description={t('bbb.webcamsOnlyModeratorDescription')}
                        checked={settings.defaultBbbWebcamsOnlyForModerator}
                        onChange={(v) => togglePrimitive('defaultBbbWebcamsOnlyForModerator', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('bbb.listenOnlyTitle')}
                        description={t('bbb.listenOnlyDescription')}
                        checked={settings.defaultBbbDisableMic}
                        onChange={(v) => togglePrimitive('defaultBbbDisableMic', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('bbb.disableCamTitle')}
                        description={t('bbb.disableCamDescription')}
                        checked={settings.defaultBbbDisableCam}
                        onChange={(v) => togglePrimitive('defaultBbbDisableCam', v)}
                    />
                    <Separator />
                    <div className="flex items-start justify-between gap-4 py-3">
                        <div className="flex-1">
                            <div className="text-sm font-medium text-neutral-800">
                                {t('bbb.guestPolicyTitle')}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                                {t('bbb.guestPolicyDescription')}
                            </div>
                        </div>
                        <Select
                            value={settings.defaultBbbGuestPolicy}
                            onValueChange={(v) =>
                                setSettings((prev) => ({
                                    ...prev,
                                    defaultBbbGuestPolicy: v as LiveSessionGuestPolicy,
                                }))
                            }
                        >
                            <SelectTrigger className="h-9 w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALWAYS_ACCEPT">
                                    {t('bbb.guestPolicyAlwaysAccept')}
                                </SelectItem>
                                <SelectItem value="ASK_MODERATOR">
                                    {t('bbb.guestPolicyAskModerator')}
                                </SelectItem>
                                <SelectItem value="ALWAYS_DENY">
                                    {t('bbb.guestPolicyAlwaysDeny')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Separator />
                    <SettingRow
                        title={t('bbb.disablePrivateChatTitle')}
                        description={t('bbb.disablePrivateChatDescription')}
                        checked={settings.defaultBbbDisablePrivateChat}
                        onChange={(v) => togglePrimitive('defaultBbbDisablePrivateChat', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('bbb.disablePublicChatTitle')}
                        description={t('bbb.disablePublicChatDescription')}
                        checked={settings.defaultBbbDisablePublicChat}
                        onChange={(v) => togglePrimitive('defaultBbbDisablePublicChat', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('bbb.disableSharedNotesTitle')}
                        description={t('bbb.disableSharedNotesDescription')}
                        checked={settings.defaultBbbDisableSharedNotes}
                        onChange={(v) => togglePrimitive('defaultBbbDisableSharedNotes', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('bbb.hideUserListTitle')}
                        description={t('bbb.hideUserListDescription')}
                        checked={settings.defaultBbbHideUserList}
                        onChange={(v) => togglePrimitive('defaultBbbHideUserList', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('bbb.endWhenNoModeratorTitle')}
                        description={t('bbb.endWhenNoModeratorDescription')}
                        checked={settings.defaultBbbEndWhenNoModerator}
                        onChange={(v) => togglePrimitive('defaultBbbEndWhenNoModerator', v)}
                    />
                </CardContent>
            </Card>

            {/* Zoom meeting control defaults (single-class Zoom sessions only) */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <MonitorPlay size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('zoom.title')}</CardTitle>
                        <CardDescription>{t('zoom.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('zoom.entrySecurityGroup')}
                    </div>
                    <SettingRow
                        title={t('zoom.waitingRoomTitle')}
                        description={t('zoom.waitingRoomDescription')}
                        checked={settings.defaultZoomWaitingRoom}
                        onChange={(v) => togglePrimitive('defaultZoomWaitingRoom', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('zoom.joinBeforeHostTitle')}
                        description={t('zoom.joinBeforeHostDescription')}
                        checked={settings.defaultZoomJoinBeforeHost}
                        onChange={(v) => togglePrimitive('defaultZoomJoinBeforeHost', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('zoom.authenticationTitle')}
                        description={t('zoom.authenticationDescription')}
                        checked={settings.defaultZoomMeetingAuthentication}
                        onChange={(v) => togglePrimitive('defaultZoomMeetingAuthentication', v)}
                    />
                    <Separator />
                    <div className="flex items-start justify-between gap-4 py-3">
                        <div className="flex-1">
                            <div className="text-sm font-medium text-neutral-800">
                                {t('zoom.approvalTitle')}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                                {t('zoom.approvalDescription')}
                            </div>
                        </div>
                        <Select
                            value={settings.defaultZoomApprovalType}
                            onValueChange={(v) =>
                                setSettings((prev) => ({
                                    ...prev,
                                    defaultZoomApprovalType: v as ZoomApprovalType,
                                }))
                            }
                        >
                            <SelectTrigger className="h-9 w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="2">{t('zoom.approvalNoneRequired')}</SelectItem>
                                <SelectItem value="0">{t('zoom.approvalAutomatic')}</SelectItem>
                                <SelectItem value="1">{t('zoom.approvalManual')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="mt-4 border-t border-neutral-100 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('zoom.audioVideoGroup')}
                    </div>
                    <SettingRow
                        title={t('zoom.muteUponEntryTitle')}
                        description={t('zoom.muteUponEntryDescription')}
                        checked={settings.defaultZoomMuteUponEntry}
                        onChange={(v) => togglePrimitive('defaultZoomMuteUponEntry', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('zoom.hostVideoTitle')}
                        description={t('zoom.hostVideoDescription')}
                        checked={settings.defaultZoomHostVideo}
                        onChange={(v) => togglePrimitive('defaultZoomHostVideo', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('zoom.participantVideoTitle')}
                        description={t('zoom.participantVideoDescription')}
                        checked={settings.defaultZoomParticipantVideo}
                        onChange={(v) => togglePrimitive('defaultZoomParticipantVideo', v)}
                    />
                    <Separator />
                    <div className="flex items-start justify-between gap-4 py-3">
                        <div className="flex-1">
                            <div className="text-sm font-medium text-neutral-800">
                                {t('zoom.audioLabel')}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                                {t('zoom.audioDescription')}
                            </div>
                        </div>
                        <Select
                            value={settings.defaultZoomAudio}
                            onValueChange={(v) =>
                                setSettings((prev) => ({
                                    ...prev,
                                    defaultZoomAudio: v as ZoomAudioOption,
                                }))
                            }
                        >
                            <SelectTrigger className="h-9 w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="both">{t('zoom.audioBoth')}</SelectItem>
                                <SelectItem value="voip">{t('zoom.audioVoip')}</SelectItem>
                                <SelectItem value="telephony">{t('zoom.audioTelephony')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="mt-4 border-t border-neutral-100 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('zoom.inMeetingGroup')}
                    </div>
                    <SettingRow
                        title={t('zoom.breakoutRoomTitle')}
                        description={t('zoom.breakoutRoomDescription')}
                        checked={settings.defaultZoomBreakoutRoom}
                        onChange={(v) => togglePrimitive('defaultZoomBreakoutRoom', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('zoom.focusModeTitle')}
                        description={t('zoom.focusModeDescription')}
                        checked={settings.defaultZoomFocusMode}
                        onChange={(v) => togglePrimitive('defaultZoomFocusMode', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('zoom.multipleDevicesTitle')}
                        description={t('zoom.multipleDevicesDescription')}
                        checked={settings.defaultZoomAllowMultipleDevices}
                        onChange={(v) => togglePrimitive('defaultZoomAllowMultipleDevices', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('zoom.watermarkTitle')}
                        description={t('zoom.watermarkDescription')}
                        checked={settings.defaultZoomWatermark}
                        onChange={(v) => togglePrimitive('defaultZoomWatermark', v)}
                    />
                    <Separator />
                    <div className="flex items-start justify-between gap-4 py-3">
                        <div className="flex-1">
                            <div className="text-sm font-medium text-neutral-800">
                                {t('zoom.autoRecordingTitle')}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                                {t('zoom.autoRecordingDescription')}
                            </div>
                        </div>
                        <Select
                            value={settings.defaultZoomAutoRecording}
                            onValueChange={(v) =>
                                setSettings((prev) => ({
                                    ...prev,
                                    defaultZoomAutoRecording: v as ZoomAutoRecordingOption,
                                }))
                            }
                        >
                            <SelectTrigger className="h-9 w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cloud">{t('zoom.autoRecordingCloud')}</SelectItem>
                                <SelectItem value="local">{t('zoom.autoRecordingLocal')}</SelectItem>
                                <SelectItem value="none">{t('zoom.autoRecordingNone')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Google Meet control defaults (single-class Meet sessions with a connected account) */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <VideoCamera size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('googleMeet.title')}</CardTitle>
                        <CardDescription>{t('googleMeet.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('googleMeet.recordingGroup')}
                    </div>
                    {/* Load errors are shown by the Google Meet Integration card above. */}
                    {googleAccountsLoaded && activeGoogleAccounts.length === 0 && (
                        <div className="py-3 text-xs text-neutral-500">
                            {t('googleMeet.noAccount')}
                        </div>
                    )}
                    {activeGoogleAccounts.map((a) => (
                        <div key={a.id}>
                            <SettingRow
                                title={t('googleMeet.autoRecordTitle', {
                                    email: a.organizerEmail,
                                })}
                                description={t('googleMeet.autoRecordDescription')}
                                checked={googleRecordDrafts[a.id] ?? !!a.recordingEnabled}
                                onChange={(v) =>
                                    setGoogleRecordDraft(a.id, !!a.recordingEnabled, v)
                                }
                            />
                            <Separator />
                        </div>
                    ))}
                    <SettingRow
                        title={t('googleMeet.transcriptionTitle')}
                        description={t('googleMeet.transcriptionDescription')}
                        checked={settings.defaultGoogleMeetTranscription}
                        onChange={(v) => togglePrimitive('defaultGoogleMeetTranscription', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('googleMeet.smartNotesTitle')}
                        description={t('googleMeet.smartNotesDescription')}
                        checked={settings.defaultGoogleMeetSmartNotes}
                        onChange={(v) => togglePrimitive('defaultGoogleMeetSmartNotes', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('googleMeet.attendanceReportTitle')}
                        description={t('googleMeet.attendanceReportDescription')}
                        checked={settings.defaultGoogleMeetAttendanceReport}
                        onChange={(v) => togglePrimitive('defaultGoogleMeetAttendanceReport', v)}
                    />
                    <div className="py-2 text-xs text-neutral-500">{t('googleMeet.planHint')}</div>

                    <div className="mt-4 border-t border-neutral-100 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('googleMeet.hostControlsGroup')}
                    </div>
                    <SettingRow
                        title={t('googleMeet.hostManagementTitle')}
                        description={t('googleMeet.hostManagementDescription')}
                        checked={settings.defaultGoogleMeetHostManagement}
                        onChange={(v) => togglePrimitive('defaultGoogleMeetHostManagement', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('googleMeet.chatHostsOnlyTitle')}
                        description={t('googleMeet.chatHostsOnlyDescription')}
                        checked={settings.defaultGoogleMeetChatHostsOnly}
                        onChange={(v) => togglePrimitive('defaultGoogleMeetChatHostsOnly', v)}
                        disabled={!settings.defaultGoogleMeetHostManagement}
                        disabledReason={t('googleMeet.disabledBecauseHostControlsOff')}
                    />
                    <Separator />
                    <SettingRow
                        title={t('googleMeet.reactionsHostsOnlyTitle')}
                        description={t('googleMeet.reactionsHostsOnlyDescription')}
                        checked={settings.defaultGoogleMeetReactionsHostsOnly}
                        onChange={(v) => togglePrimitive('defaultGoogleMeetReactionsHostsOnly', v)}
                        disabled={!settings.defaultGoogleMeetHostManagement}
                        disabledReason={t('googleMeet.disabledBecauseHostControlsOff')}
                    />
                    <Separator />
                    <SettingRow
                        title={t('googleMeet.presentHostsOnlyTitle')}
                        description={t('googleMeet.presentHostsOnlyDescription')}
                        checked={settings.defaultGoogleMeetPresentHostsOnly}
                        onChange={(v) => togglePrimitive('defaultGoogleMeetPresentHostsOnly', v)}
                        disabled={!settings.defaultGoogleMeetHostManagement}
                        disabledReason={t('googleMeet.disabledBecauseHostControlsOff')}
                    />
                    <Separator />
                    <SettingRow
                        title={t('googleMeet.joinAsViewerTitle')}
                        description={t('googleMeet.joinAsViewerDescription')}
                        checked={settings.defaultGoogleMeetJoinAsViewer}
                        onChange={(v) => togglePrimitive('defaultGoogleMeetJoinAsViewer', v)}
                        disabled={!settings.defaultGoogleMeetHostManagement}
                        disabledReason={t('googleMeet.disabledBecauseHostControlsOff')}
                    />
                </CardContent>
            </Card>

            {/* Notification defaults (channels + triggers) */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <BellRinging size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('notifications.title')}</CardTitle>
                        <CardDescription>{t('notifications.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('notifications.channelsGroup')}
                    </div>
                    <SettingRow
                        title={t('notifications.emailTitle')}
                        description={t('notifications.emailDescription')}
                        checked={settings.defaultNotifyByEmail}
                        onChange={(v) => togglePrimitive('defaultNotifyByEmail', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('notifications.whatsappTitle')}
                        description={t('notifications.whatsappDescription')}
                        checked={settings.defaultNotifyByWhatsapp}
                        onChange={(v) => togglePrimitive('defaultNotifyByWhatsapp', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('notifications.pushTitle')}
                        description={t('notifications.pushDescription')}
                        checked={settings.defaultNotifyByPush}
                        onChange={(v) => togglePrimitive('defaultNotifyByPush', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('notifications.systemTitle')}
                        description={t('notifications.systemDescription')}
                        checked={settings.defaultNotifyBySystem}
                        onChange={(v) => togglePrimitive('defaultNotifyBySystem', v)}
                    />

                    <div className="mt-4 border-t border-neutral-100 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('notifications.triggersGroup')}
                    </div>
                    <SettingRow
                        title={t('notifications.onCreateTitle')}
                        description={t('notifications.onCreateDescription')}
                        checked={settings.defaultNotifyOnCreate}
                        onChange={(v) => togglePrimitive('defaultNotifyOnCreate', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('notifications.onLiveTitle')}
                        description={t('notifications.onLiveDescription')}
                        checked={settings.defaultNotifyOnLive}
                        onChange={(v) => togglePrimitive('defaultNotifyOnLive', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('notifications.onAttendanceTitle')}
                        description={t('notifications.onAttendanceDescription')}
                        checked={settings.defaultNotifyOnAttendance}
                        onChange={(v) => togglePrimitive('defaultNotifyOnAttendance', v)}
                    />
                    <Separator />
                    <div className="flex items-start justify-between gap-4 py-3">
                        <div className="flex-1">
                            <div className="text-sm font-medium text-neutral-800">
                                {t('notifications.reminderTitle')}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                                {t('notifications.reminderDescription')}
                            </div>
                        </div>
                        <Select
                            value={settings.defaultNotifyBeforeReminder || NO_REMINDER}
                            onValueChange={(v) =>
                                setSettings((prev) => ({
                                    ...prev,
                                    defaultNotifyBeforeReminder: v === NO_REMINDER ? '' : v,
                                }))
                            }
                        >
                            <SelectTrigger className="h-9 w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_REMINDER}>
                                    {t('notifications.noReminder')}
                                </SelectItem>
                                {REMINDER_OPTION_VALUES.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {t(`reminderOptions.${value}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Custom action button */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <CursorClick size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">
                            {t('customActionButton.title')}
                        </CardTitle>
                        <CardDescription>{t('customActionButton.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('customActionButton.cardTitle')}
                        description={t('customActionButton.cardDescription')}
                        checked={settings.customActionButtonEnabled}
                        onChange={(v) => togglePrimitive('customActionButtonEnabled', v)}
                    />
                </CardContent>
            </Card>

            {/* Recording transcription */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <FileText size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('transcription.title')}</CardTitle>
                        <CardDescription>{t('transcription.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('transcription.buttonTitle')}
                        description={t('transcription.buttonDescription')}
                        checked={settings.recordingTranscriptionEnabled}
                        onChange={(v) => togglePrimitive('recordingTranscriptionEnabled', v)}
                    />
                </CardContent>
            </Card>

            {/* Minimum Attendance — present only if actually in the class long enough */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <UserCheck size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('attendance.title')}</CardTitle>
                        <CardDescription>{t('attendance.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4 border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('attendance.requireTitle')}
                        description={t('attendance.requireDescription')}
                        checked={settings.defaultAttendanceCriteria.enabled}
                        onChange={(v) =>
                            setSettings((prev) => ({
                                ...prev,
                                defaultAttendanceCriteria: {
                                    ...prev.defaultAttendanceCriteria,
                                    enabled: v,
                                },
                            }))
                        }
                    />

                    {settings.defaultAttendanceCriteria.enabled && (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                            <div className="flex-1">
                                <div className="text-sm font-medium text-neutral-800">
                                    {t('attendance.minShareLabel')}
                                </div>
                                <div className="mt-0.5 text-xs text-neutral-500">
                                    {t('attendance.minShareDescription')}
                                </div>
                            </div>
                            <Select
                                value={String(
                                    settings.defaultAttendanceCriteria.minDurationPercent || 60
                                )}
                                onValueChange={(v) =>
                                    setSettings((prev) => ({
                                        ...prev,
                                        defaultAttendanceCriteria: {
                                            ...prev.defaultAttendanceCriteria,
                                            minDurationPercent: Number(v),
                                        },
                                    }))
                                }
                            >
                                <SelectTrigger className="h-9 w-full sm:w-52">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[25, 40, 50, 60, 70, 75, 80, 90].map((pct) => (
                                        <SelectItem key={pct} value={String(pct)}>
                                            {t('attendance.percentOfClass', { percent: pct })}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* LMS Connection — live class content → course chapters */}
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <PlugsConnected size={18} />
                    </div>
                    <div className="flex-1">
                        <CardTitle className="text-base">{t('lms.title')}</CardTitle>
                        <CardDescription>{t('lms.description')}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="border-t border-neutral-100 p-5">
                    <SettingRow
                        title={t('lms.addRecordingsTitle')}
                        description={t('lms.addRecordingsDescription')}
                        checked={settings.lmsConnection.recordingAddToCourseEnabled}
                        onChange={(v) => toggleLmsConnection('recordingAddToCourseEnabled', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('lms.classMaterialsTitle')}
                        description={t('lms.classMaterialsDescription')}
                        checked={settings.lmsConnection.classMaterialsEnabled}
                        onChange={(v) => toggleLmsConnection('classMaterialsEnabled', v)}
                    />
                    <Separator />
                    <SettingRow
                        title={t('lms.autoUploadTitle')}
                        description={t('lms.autoUploadDescription')}
                        checked={settings.lmsConnection.autoUploadRecordingsEnabled}
                        onChange={(v) => toggleLmsConnection('autoUploadRecordingsEnabled', v)}
                    />
                    {settings.lmsConnection.autoUploadRecordingsEnabled && (
                        <div className="pl-4">
                            <SettingRow
                                title={t('lms.notifyOnAutoUploadTitle')}
                                description={t('lms.notifyOnAutoUploadDescription')}
                                checked={settings.lmsConnection.autoUploadNotifyLearners}
                                onChange={(v) => toggleLmsConnection('autoUploadNotifyLearners', v)}
                            />
                        </div>
                    )}
                    {settings.lmsConnection.autoUploadRecordingsEnabled && (
                        <div className="pb-1 pl-1 pt-2">
                            <DefaultRecordingDestinationPicker
                                value={settings.lmsConnection.autoUploadDefaultDestination}
                                onChange={(dest) =>
                                    setSettings((prev) => ({
                                        ...prev,
                                        lmsConnection: {
                                            ...prev.lmsConnection,
                                            autoUploadDefaultDestination: dest,
                                        },
                                    }))
                                }
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
                <CursorClick size={14} className="-mt-0.5 mr-1 inline" />
                {t('footer.notePrefix')} <strong>{t('footer.noteBold')}</strong>{' '}
                {t('footer.noteSuffix')}
            </div>
        </div>
    );
}
