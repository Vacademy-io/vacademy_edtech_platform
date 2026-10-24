import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    YoutubeLogo,
    ArrowSquareOut,
    Check,
    Warning,
    ArrowsClockwise,
    Plug,
    PlugsConnected,
    CloudArrowUp,
    type Icon,
} from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    YoutubeConnectionStatus,
    YoutubeUploadDefaults,
    YoutubeUploadJob,
    disconnectYoutube,
    getYoutubeDefaults,
    getYoutubeStatus,
    initiateYoutubeOAuth,
    listYoutubeJobs,
    retryYoutubeUpload,
    updateYoutubeDefaults,
} from '../-services/youtube-integration-service';

// YouTube content categories most relevant for an EdTech platform. Full list
// at https://developers.google.com/youtube/v3/docs/videoCategories/list — we
// only surface the ones an admin will ever realistically pick.
function getCategoryOptions(t: TFunction): { id: string; label: string }[] {
    return [
        { id: '27', label: t('categoryOptions.education') },
        { id: '28', label: t('categoryOptions.scienceAndTechnology') },
        { id: '22', label: t('categoryOptions.peopleAndBlogs') },
        { id: '25', label: t('categoryOptions.newsAndPolitics') },
        { id: '24', label: t('categoryOptions.entertainment') },
        { id: '20', label: t('categoryOptions.gaming') },
        { id: '26', label: t('categoryOptions.howToAndStyle') },
    ];
}

function getPrivacyOptions(
    t: TFunction
): { value: 'public' | 'unlisted' | 'private'; label: string; help: string }[] {
    return [
        {
            value: 'unlisted',
            label: t('privacyOptions.unlisted.label'),
            help: t('privacyOptions.unlisted.help'),
        },
        {
            value: 'private',
            label: t('privacyOptions.private.label'),
            help: t('privacyOptions.private.help'),
        },
        {
            value: 'public',
            label: t('privacyOptions.public.label'),
            help: t('privacyOptions.public.help'),
        },
    ];
}

export default function YoutubeIntegrationSettings() {
    const { t } = useTranslation('settingsYoutubeIntegration');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';

    // Surface the post-OAuth ?yt=connected / ?yt=error flag that the backend
    // redirect target sets, then clean it out of the URL.
    const [oauthFlag, setOauthFlag] = useState<string | null>(null);
    useEffect(() => {
        const url = new URL(window.location.href);
        const yt = url.searchParams.get('yt');
        const reason = url.searchParams.get('reason');
        if (yt) {
            setOauthFlag(yt);
            if (yt === 'connected') toast.success(t('toasts.channelConnected'));
            if (yt === 'error')
                toast.error(t('toasts.connectFailed', { reason: reason ?? t('toasts.unknownReason') }));
            url.searchParams.delete('yt');
            url.searchParams.delete('reason');
            window.history.replaceState({}, '', url.toString());
        }
    }, []);

    // Connection status
    const { data: status, isLoading: statusLoading } = useQuery({
        queryKey: ['youtube-status', instituteId, oauthFlag],
        queryFn: () => getYoutubeStatus(instituteId),
        enabled: !!instituteId,
    });

    // Defaults
    const { data: defaults, isLoading: defaultsLoading } = useQuery({
        queryKey: ['youtube-defaults', instituteId],
        queryFn: () => getYoutubeDefaults(instituteId),
        enabled: !!instituteId,
    });

    // Upload history
    const { data: jobs = [], isLoading: jobsLoading } = useQuery({
        queryKey: ['youtube-jobs', instituteId],
        queryFn: () => listYoutubeJobs(instituteId),
        enabled: !!instituteId,
        // Polling while uploads are in flight keeps the table fresh without
        // adding websockets. Cheap because the endpoint is paged.
        refetchInterval: (q) => {
            const data = q.state.data as YoutubeUploadJob[] | undefined;
            return data?.some((j) => j.status === 'QUEUED' || j.status === 'UPLOADING')
                ? 5_000
                : false;
        },
    });

    const featureEnabled = defaults?.featureEnabled ?? false;

    return (
        <div className="flex flex-col gap-5 p-1">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-neutral-800">{t('header.title')}</h2>
                    <p className="text-sm text-neutral-500">{t('header.subtitle')}</p>
                </div>
            </header>

            <FeatureGateCard
                instituteId={instituteId}
                defaults={defaults}
                loading={defaultsLoading}
            />

            {featureEnabled && (
                <>
                    <ConnectionCard
                        status={status}
                        loading={statusLoading}
                        instituteId={instituteId}
                        onReload={() => {
                            queryClient.invalidateQueries({ queryKey: ['youtube-status'] });
                            queryClient.invalidateQueries({ queryKey: ['youtube-jobs'] });
                        }}
                    />

                    {status?.status === 'ACTIVE' && (
                        <DefaultsCard
                            instituteId={instituteId}
                            defaults={defaults}
                            loading={defaultsLoading}
                        />
                    )}

                    <UploadHistoryCard
                        jobs={jobs}
                        loading={jobsLoading}
                        connected={status?.status === 'ACTIVE'}
                    />
                </>
            )}
        </div>
    );
}

// ─── Feature-gate card (master toggle) ───────────────────────────────────────

function FeatureGateCard({
    instituteId,
    defaults,
    loading,
}: {
    instituteId: string;
    defaults?: YoutubeUploadDefaults;
    loading: boolean;
}) {
    const { t } = useTranslation('settingsYoutubeIntegration');
    const queryClient = useQueryClient();

    // Mutation flips the master switch. We send the full defaults payload so
    // the row gets created on first opt-in (the PUT endpoint upserts).
    const { mutate: toggleFeature, isPending } = useMutation({
        mutationFn: (next: boolean) =>
            updateYoutubeDefaults(instituteId, {
                ...(defaults ?? platformFallback()),
                featureEnabled: next,
            }),
        onSuccess: (_data, next) => {
            toast.success(next ? t('toasts.featureEnabled') : t('toasts.featureDisabled'));
            queryClient.invalidateQueries({ queryKey: ['youtube-defaults', instituteId] });
            queryClient.invalidateQueries({ queryKey: ['youtube-status', instituteId] });
            queryClient.invalidateQueries({ queryKey: ['youtube-jobs', instituteId] });
        },
        onError: () => toast.error(t('toasts.toggleFailed')),
    });

    const featureEnabled = defaults?.featureEnabled ?? false;

    return (
        <Card className="border-neutral-200 shadow-none">
            <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                <div className="flex size-9 items-center justify-center rounded-md bg-red-50 text-red-600">
                    <YoutubeLogo size={20} weight="fill" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base">{t('featureGate.title')}</CardTitle>
                    <CardDescription>{t('featureGate.description')}</CardDescription>
                </div>
                <Switch
                    checked={featureEnabled}
                    disabled={loading || isPending}
                    onCheckedChange={(v) => toggleFeature(v)}
                />
            </CardHeader>
            {!featureEnabled && (
                <CardContent className="border-t border-neutral-100 p-5 text-sm text-neutral-500">
                    {t('featureGate.hint')}
                </CardContent>
            )}
        </Card>
    );
}

/** Fallback used when the institute has never opened this page before — keeps
 *  the toggle-on PUT well-formed so the server can upsert a clean row. */
function platformFallback(): YoutubeUploadDefaults {
    return {
        featureEnabled: false,
        autoUploadEnabled: true,
        privacyStatus: 'unlisted',
        embeddable: true,
        publicStatsViewable: false,
        madeForKids: false,
        categoryId: '27',
        license: 'youtube',
        titleTemplate: '{session_title} | {date}',
        notifySubscribers: false,
    };
}

// ─── Connection card ─────────────────────────────────────────────────────────

function ConnectionCard({
    status,
    loading,
    instituteId,
    onReload,
}: {
    status?: YoutubeConnectionStatus;
    loading: boolean;
    instituteId: string;
    onReload: () => void;
}) {
    const { t } = useTranslation('settingsYoutubeIntegration');
    const { mutate: connect, isPending: connecting } = useMutation({
        mutationFn: () => initiateYoutubeOAuth(instituteId),
        onSuccess: (data) => {
            window.location.href = data.authorization_url;
        },
        onError: () => toast.error(t('toasts.oauthStartFailed')),
    });

    const { mutate: disconnect, isPending: disconnecting } = useMutation({
        mutationFn: () => disconnectYoutube(instituteId),
        onSuccess: () => {
            toast.success(t('toasts.disconnected'));
            onReload();
        },
        onError: () => toast.error(t('toasts.disconnectFailed')),
    });

    const s = status?.status ?? 'NOT_CONNECTED';

    return (
        <Card className="border-neutral-200 shadow-none">
            <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                <div className="flex size-9 items-center justify-center rounded-md bg-red-50 text-red-600">
                    <YoutubeLogo size={20} weight="fill" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base">{t('connection.title')}</CardTitle>
                    <CardDescription>{t('connection.description')}</CardDescription>
                </div>
                <StatusBadge status={s} />
            </CardHeader>
            <CardContent className="border-t border-neutral-100 p-5">
                {loading ? (
                    <div className="text-sm text-neutral-500">{t('connection.loading')}</div>
                ) : s === 'ACTIVE' ? (
                    <div className="flex flex-wrap items-center gap-4">
                        {status?.channelThumbnailUrl && (
                            <img
                                src={status.channelThumbnailUrl}
                                alt={status.channelTitle ?? t('channelThumbnailAlt')}
                                className="size-12 rounded-full"
                            />
                        )}
                        <div className="flex-1 min-w-[200px]">
                            <div className="text-sm font-medium text-neutral-800">
                                {status?.channelTitle ?? t('connection.unnamedChannel')}
                            </div>
                            {status?.channelId && (
                                <a
                                    href={`https://www.youtube.com/channel/${status.channelId}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-red-600"
                                >
                                    {status.channelId}
                                    <ArrowSquareOut size={12} />
                                </a>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => connect()}
                                disabled={connecting}
                            >
                                <ArrowsClockwise className="mr-1 size-3.5" />
                                {t('connection.reconnect')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => disconnect()}
                                disabled={disconnecting}
                                className="text-red-600 hover:text-red-700"
                            >
                                {t('connection.disconnect')}
                            </Button>
                        </div>
                    </div>
                ) : s === 'INVALID' ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[240px]">
                            <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                                <Warning size={16} />
                                {t('connection.invalidTitle')}
                            </div>
                            <p className="mt-1 text-xs text-neutral-500">
                                {status?.lastError ?? t('connection.invalidDefaultReason')}
                            </p>
                        </div>
                        <Button onClick={() => connect()} disabled={connecting}>
                            <PlugsConnected className="mr-1 size-4" />
                            {connecting ? t('connection.redirecting') : t('connection.reconnectYoutube')}
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[240px] text-sm text-neutral-500">
                            {t('connection.notConnected')}
                        </div>
                        <Button onClick={() => connect()} disabled={connecting}>
                            <Plug className="mr-1 size-4" />
                            {connecting ? t('connection.redirecting') : t('connection.connectYoutube')}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function StatusBadge({ status }: { status: 'ACTIVE' | 'INVALID' | 'NOT_CONNECTED' }) {
    const { t } = useTranslation('settingsYoutubeIntegration');
    const cfg = {
        ACTIVE: { label: t('status.active'), color: 'bg-green-100 text-green-700' },
        INVALID: { label: t('status.invalid'), color: 'bg-amber-100 text-amber-700' },
        NOT_CONNECTED: { label: t('status.notConnected'), color: 'bg-neutral-100 text-neutral-600' },
    }[status];
    return (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
            {cfg.label}
        </span>
    );
}

// ─── Defaults card ───────────────────────────────────────────────────────────

function DefaultsCard({
    instituteId,
    defaults,
    loading,
}: {
    instituteId: string;
    defaults?: YoutubeUploadDefaults;
    loading: boolean;
}) {
    const { t } = useTranslation('settingsYoutubeIntegration');
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState<YoutubeUploadDefaults | null>(null);

    useEffect(() => {
        if (defaults) setDraft(defaults);
    }, [defaults]);

    const dirty = useMemo(
        () => !!draft && !!defaults && JSON.stringify(draft) !== JSON.stringify(defaults),
        [draft, defaults]
    );

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: (next: YoutubeUploadDefaults) => updateYoutubeDefaults(instituteId, next),
        onSuccess: () => {
            toast.success(t('toasts.defaultsSaved'));
            queryClient.invalidateQueries({ queryKey: ['youtube-defaults', instituteId] });
        },
        onError: () => toast.error(t('toasts.defaultsSaveFailed')),
    });

    if (loading || !draft) {
        return (
            <Card className="border-neutral-200 shadow-none">
                <CardHeader className="p-5">
                    <CardTitle className="text-base">{t('defaults.title')}</CardTitle>
                </CardHeader>
                <CardContent className="p-5 pt-0 text-sm text-neutral-500">
                    {t('defaults.loading')}
                </CardContent>
            </Card>
        );
    }

    const set = (patch: Partial<YoutubeUploadDefaults>) =>
        setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

    const privacyOptions = getPrivacyOptions(t);
    const categoryOptions = getCategoryOptions(t);

    return (
        <Card className="border-neutral-200 shadow-none">
            <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <CloudArrowUp size={18} />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base">{t('defaults.title')}</CardTitle>
                    <CardDescription>{t('defaults.description')}</CardDescription>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!dirty || saving}
                        onClick={() => defaults && setDraft(defaults)}
                    >
                        {t('defaults.reset')}
                    </Button>
                    <Button
                        size="sm"
                        disabled={!dirty || saving}
                        onClick={() => draft && save(draft)}
                        className="bg-primary-500 hover:bg-primary-600"
                    >
                        {saving ? t('defaults.saving') : t('defaults.save')}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-5 border-t border-neutral-100 p-5">
                <SettingRow
                    title={t('defaults.autoUpload.title')}
                    description={t('defaults.autoUpload.description')}
                    checked={draft.autoUploadEnabled}
                    onChange={(v) => set({ autoUploadEnabled: v })}
                />

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label className="text-xs">{t('defaults.privacyLabel')}</Label>
                        <Select
                            value={draft.privacyStatus}
                            onValueChange={(v) =>
                                set({ privacyStatus: v as YoutubeUploadDefaults['privacyStatus'] })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {privacyOptions.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-[11px] text-neutral-500">
                            {privacyOptions.find((p) => p.value === draft.privacyStatus)?.help}
                        </p>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">{t('defaults.categoryLabel')}</Label>
                        <Select
                            value={draft.categoryId}
                            onValueChange={(v) => set({ categoryId: v })}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {categoryOptions.map((opt) => (
                                    <SelectItem key={opt.id} value={opt.id}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">{t('defaults.licenseLabel')}</Label>
                        <Select
                            value={draft.license}
                            onValueChange={(v) =>
                                set({ license: v as YoutubeUploadDefaults['license'] })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="youtube">
                                    {t('defaults.licenseStandard')}
                                </SelectItem>
                                <SelectItem value="creativeCommon">
                                    {t('defaults.licenseCreativeCommons')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">{t('defaults.defaultLanguageLabel')}</Label>
                        <Input
                            placeholder={t('defaults.defaultLanguagePlaceholder')}
                            value={draft.defaultLanguage ?? ''}
                            onChange={(e) => set({ defaultLanguage: e.target.value })}
                        />
                    </div>
                </div>

                <Separator />

                <SettingRow
                    title={t('defaults.embeddable.title')}
                    description={t('defaults.embeddable.description')}
                    checked={draft.embeddable}
                    onChange={(v) => set({ embeddable: v })}
                />
                <SettingRow
                    title={t('defaults.publicStats.title')}
                    description={t('defaults.publicStats.description')}
                    checked={draft.publicStatsViewable}
                    onChange={(v) => set({ publicStatsViewable: v })}
                />
                <SettingRow
                    title={t('defaults.madeForKids.title')}
                    description={t('defaults.madeForKids.description')}
                    checked={draft.madeForKids}
                    onChange={(v) => set({ madeForKids: v })}
                />
                <SettingRow
                    title={t('defaults.notifySubscribers.title')}
                    description={t('defaults.notifySubscribers.description')}
                    checked={draft.notifySubscribers}
                    onChange={(v) => set({ notifySubscribers: v })}
                />

                <Separator />

                <div className="space-y-1.5">
                    <Label className="text-xs">
                        {t('defaults.titleTemplateLabel')}
                        <span className="ml-2 font-normal text-neutral-500">
                            {t('defaults.titleTemplateTokens')}
                        </span>
                    </Label>
                    <Input
                        value={draft.titleTemplate}
                        onChange={(e) => set({ titleTemplate: e.target.value })}
                        placeholder={t('defaults.titleTemplatePlaceholder')}
                    />
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs">
                        {t('defaults.descriptionTemplateLabel')}
                        <span className="ml-2 font-normal text-neutral-500">
                            {t('defaults.descriptionTemplateTokensHint')}
                        </span>
                    </Label>
                    <Textarea
                        rows={4}
                        value={draft.descriptionTemplate ?? ''}
                        onChange={(e) => set({ descriptionTemplate: e.target.value })}
                        placeholder={t('defaults.descriptionTemplatePlaceholder')}
                    />
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs">{t('defaults.tagsLabel')}</Label>
                    <Input
                        value={draft.tagsCsv ?? ''}
                        onChange={(e) => set({ tagsCsv: e.target.value })}
                        placeholder={t('defaults.tagsPlaceholder')}
                    />
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs">{t('defaults.playlistLabel')}</Label>
                    <Input
                        value={draft.defaultPlaylistId ?? ''}
                        onChange={(e) => set({ defaultPlaylistId: e.target.value })}
                        placeholder={t('defaults.playlistPlaceholder')}
                    />
                    <p className="text-[11px] text-neutral-500">{t('defaults.playlistHint')}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function SettingRow({
    title,
    description,
    checked,
    onChange,
}: {
    title: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
                <div className="text-sm font-medium text-neutral-800">{title}</div>
                <div className="mt-0.5 text-xs text-neutral-500">{description}</div>
            </div>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    );
}

// ─── Upload history card ─────────────────────────────────────────────────────

function UploadHistoryCard({
    jobs,
    loading,
    connected,
}: {
    jobs: YoutubeUploadJob[];
    loading: boolean;
    connected: boolean;
}) {
    const { t } = useTranslation('settingsYoutubeIntegration');
    const queryClient = useQueryClient();
    const { mutate: retry, isPending: retrying } = useMutation({
        mutationFn: (jobId: string) => retryYoutubeUpload(jobId),
        onSuccess: () => {
            toast.success(t('toasts.requeued'));
            queryClient.invalidateQueries({ queryKey: ['youtube-jobs'] });
        },
        onError: (err: unknown) => {
            const msg =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                t('toasts.retryFailed');
            toast.error(msg);
        },
    });

    return (
        <Card className="border-neutral-200 shadow-none">
            <CardHeader className="p-5 pb-4">
                <CardTitle className="text-base">{t('history.title')}</CardTitle>
                <CardDescription>{t('history.description')}</CardDescription>
            </CardHeader>
            <CardContent className="border-t border-neutral-100 p-0">
                {!connected ? (
                    <div className="p-8 text-center text-sm text-neutral-500">
                        {t('history.notConnected')}
                    </div>
                ) : loading ? (
                    <div className="p-6 text-sm text-neutral-500">{t('history.loading')}</div>
                ) : jobs.length === 0 ? (
                    <div className="p-8 text-center text-sm text-neutral-500">
                        {t('history.empty')}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b bg-neutral-50 text-xs text-neutral-500">
                                <tr>
                                    <th className="px-4 py-2">{t('history.columns.when')}</th>
                                    <th className="px-4 py-2">{t('history.columns.title')}</th>
                                    <th className="px-4 py-2">{t('history.columns.status')}</th>
                                    <th className="px-4 py-2">{t('history.columns.trigger')}</th>
                                    <th className="px-4 py-2">{t('history.columns.video')}</th>
                                    <th className="px-4 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {jobs.map((j) => (
                                    <tr key={j.id} className="border-b last:border-0">
                                        <td className="whitespace-nowrap px-4 py-2 text-xs text-neutral-500">
                                            {formatWhen(j.createdAt, t)}
                                        </td>
                                        <td className="max-w-[280px] truncate px-4 py-2">
                                            {j.title ?? (
                                                <span className="text-neutral-400">
                                                    {t('history.pendingFile', {
                                                        fileId: short(j.recordingFileId),
                                                    })}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2">
                                            <JobStatusPill job={j} />
                                        </td>
                                        <td className="px-4 py-2 text-xs text-neutral-500">
                                            {j.triggeredVia === 'AUTO'
                                                ? t('history.triggerAuto')
                                                : t('history.triggerManual')}
                                        </td>
                                        <td className="px-4 py-2">
                                            {j.youtubeVideoUrl ? (
                                                <a
                                                    href={j.youtubeVideoUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
                                                >
                                                    {t('history.open')}
                                                    <ArrowSquareOut size={12} />
                                                </a>
                                            ) : (
                                                <span className="text-xs text-neutral-300">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            {j.status === 'FAILED' && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={retrying}
                                                    onClick={() => retry(j.id)}
                                                >
                                                    {t('history.retry')}
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function JobStatusPill({ job }: { job: YoutubeUploadJob }) {
    const { t } = useTranslation('settingsYoutubeIntegration');
    const map: Record<YoutubeUploadJob['status'], { label: string; color: string; Icon: Icon }> = {
        QUEUED: {
            label:
                job.attempts > 0
                    ? t('jobStatus.queuedWithAttempt', {
                          attempt: job.attempts + 1,
                          maxAttempts: job.maxAttempts,
                      })
                    : t('jobStatus.queued'),
            color: 'bg-neutral-100 text-neutral-600',
            Icon: ArrowsClockwise,
        },
        UPLOADING: {
            label: t('jobStatus.uploading'),
            color: 'bg-blue-100 text-blue-700',
            Icon: CloudArrowUp,
        },
        DONE: { label: t('jobStatus.done'), color: 'bg-green-100 text-green-700', Icon: Check },
        FAILED: { label: t('jobStatus.failed'), color: 'bg-red-100 text-red-700', Icon: Warning },
        CANCELLED: {
            label: t('jobStatus.cancelled'),
            color: 'bg-neutral-100 text-neutral-500',
            Icon: Warning,
        },
    };
    const cfg = map[job.status];
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.color}`}
            title={job.lastError ?? undefined}
        >
            <cfg.Icon size={11} />
            {cfg.label}
        </span>
    );
}

function formatWhen(iso: string | undefined, t: TFunction) {
    if (!iso) return t('time.unknown');
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.round((now.getTime() - d.getTime()) / 60_000);
    if (diffMin < 1) return t('time.justNow');
    if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });
    if (diffMin < 60 * 24) return t('time.hoursAgo', { count: Math.round(diffMin / 60) });
    return d.toLocaleDateString();
}

function short(id?: string) {
    if (!id) return '';
    return id.length > 8 ? id.slice(0, 8) + '…' : id;
}
