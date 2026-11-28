import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash, Video, Monitor, ArrowLeft, ArrowsClockwise, ArrowSquareOut } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getInstituteId } from '@/constants/helper';
import { listApiKeys, getFirstAvailableFullKey, type ApiKey } from '../-services/api-keys';
import {
    listInputVideos,
    getInputVideoStatus,
    deleteInputVideo,
    type InputVideoRecord,
    type InputVideoStatus,
    type InputVideoMode,
} from '../-services/input-video';
import { UploadVideoDialog } from './UploadVideoDialog';
import { toast } from 'sonner';

const STATUS_COLORS: Record<InputVideoStatus, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    QUEUED: 'bg-blue-100 text-blue-700',
    PROCESSING: 'bg-yellow-100 text-yellow-800',
    COMPLETED: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
};

const MODE_ICONS: Record<string, React.ReactNode> = {
    podcast: <Video className="size-4" />,
    demo: <Monitor className="size-4" />,
};

/** Translated label for each backend status enum value — never render the raw enum. */
function buildStatusLabels(t: TFunction): Record<InputVideoStatus, string> {
    return {
        PENDING: t('status.PENDING'),
        QUEUED: t('status.QUEUED'),
        PROCESSING: t('status.PROCESSING'),
        COMPLETED: t('status.COMPLETED'),
        FAILED: t('status.FAILED'),
    };
}

/** Translated label for each backend mode enum value — never render the raw enum. */
function buildModeLabels(t: TFunction): Record<InputVideoMode, string> {
    return {
        podcast: t('mode.podcast'),
        demo: t('mode.demo'),
    };
}

function formatDate(iso: string | null): string | null {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function InputVideosPage() {
    const navigate = useNavigate();
    const instituteId = getInstituteId();
    const { t } = useTranslation('videoApiStudioInputVideosPage');

    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [videos, setVideos] = useState<InputVideoRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showUpload, setShowUpload] = useState(false);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    const apiKey = getFirstAvailableFullKey(apiKeys);
    const statusLabels = buildStatusLabels(t);
    const modeLabels = buildModeLabels(t);

    // Load API keys on mount
    useEffect(() => {
        if (!instituteId) return;
        listApiKeys(instituteId)
            .then(setApiKeys)
            .catch(() => toast.error(t('toast.apiKeysLoadError')));
    }, [instituteId, t]);

    // Load videos when API key is available
    const refreshList = useCallback(async () => {
        if (!apiKey) return;
        setIsLoading(true);
        try {
            const list = await listInputVideos(apiKey);
            setVideos(list);
        } catch {
            toast.error(t('toast.videosLoadError'));
        } finally {
            setIsLoading(false);
        }
    }, [apiKey, t]);

    useEffect(() => {
        refreshList();
    }, [refreshList]);

    // Poll active jobs every 5s
    useEffect(() => {
        if (!apiKey) return;
        const activeIds = videos
            .filter((v) => v.status === 'QUEUED' || v.status === 'PROCESSING')
            .map((v) => v.id);

        if (activeIds.length === 0) {
            if (pollRef.current) clearInterval(pollRef.current);
            return;
        }

        pollRef.current = setInterval(async () => {
            let changed = false;
            for (const id of activeIds) {
                try {
                    const s = await getInputVideoStatus(apiKey, id);
                    setVideos((prev) =>
                        prev.map((v) => {
                            if (v.id !== id) return v;
                            if (v.status !== s.status || v.progress !== s.progress) {
                                changed = true;
                                return {
                                    ...v,
                                    status: s.status,
                                    progress: s.progress,
                                    error_message: s.error_message,
                                };
                            }
                            return v;
                        })
                    );
                } catch {
                    /* swallow individual poll errors */
                }
            }
            // Refresh full list when a job completes to get output URLs
            if (changed) {
                const freshList = await listInputVideos(apiKey).catch(() => null);
                if (freshList) setVideos(freshList);
            }
        }, 5000);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [apiKey, videos]);

    const handleDelete = async (id: string, name: string) => {
        if (!apiKey) return;
        if (!confirm(t('deleteConfirm.message', { name }))) return;
        try {
            await deleteInputVideo(apiKey, id);
            setVideos((prev) => prev.filter((v) => v.id !== id));
            toast.success(t('toast.deleteSuccess'));
        } catch {
            toast.error(t('toast.deleteError'));
        }
    };

    const handleUploadComplete = () => {
        setShowUpload(false);
        refreshList();
    };

    if (!apiKey && !isLoading) {
        return (
            <div className="flex h-full items-center justify-center p-8">
                <div className="text-center">
                    <p className="mb-2 text-muted-foreground">{t('noApiKey.message')}</p>
                    <button
                        className="text-primary underline"
                        onClick={() => navigate({ to: '/video-api-studio' })}
                    >
                        {t('noApiKey.goToApiKeysButton')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate({ to: '/video-api-studio/console' })}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="size-5" />
                    </button>
                    <div>
                        <h1 className="text-lg font-semibold">{t('header.title')}</h1>
                        <p className="text-sm text-muted-foreground">{t('header.subtitle')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={refreshList}
                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
                    >
                        <ArrowsClockwise className="size-3.5" />
                        {t('header.refreshButton')}
                    </button>
                    <button
                        onClick={() => setShowUpload(true)}
                        className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
                    >
                        <Plus className="size-4" />
                        {t('uploadVideoButton')}
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto p-6">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="animate-pulse text-muted-foreground">
                            {t('empty.loading')}
                        </div>
                    </div>
                ) : videos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Video className="mb-3 size-12 text-muted-foreground" />
                        <p className="mb-1 font-medium text-muted-foreground">
                            {t('empty.title')}
                        </p>
                        <p className="mb-4 text-sm text-muted-foreground">
                            {t('empty.subtitle')}
                        </p>
                        <button
                            onClick={() => setShowUpload(true)}
                            className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium"
                        >
                            <Plus className="size-4" />
                            {t('uploadVideoButton')}
                        </button>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-left">
                                <th className="pb-2 font-medium">{t('table.columnName')}</th>
                                <th className="pb-2 font-medium">{t('table.columnMode')}</th>
                                <th className="pb-2 font-medium">{t('table.columnStatus')}</th>
                                <th className="pb-2 font-medium">{t('table.columnDuration')}</th>
                                <th className="pb-2 font-medium">{t('table.columnCreated')}</th>
                                <th className="pb-2 font-medium">{t('table.columnOutputs')}</th>
                                <th className="pb-2 font-medium"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {videos.map((v) => (
                                <tr key={v.id} className="border-b last:border-0">
                                    <td className="py-3 pr-4 font-medium">{v.name}</td>
                                    <td className="py-3 pr-4">
                                        <span className="inline-flex items-center gap-1 capitalize">
                                            {MODE_ICONS[v.mode]}
                                            {modeLabels[v.mode]}
                                        </span>
                                    </td>
                                    <td className="py-3 pr-4">
                                        <span
                                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[v.status]}`}
                                        >
                                            {statusLabels[v.status]}
                                            {v.status === 'PROCESSING' &&
                                                ` ${t('table.processingProgress', { percent: v.progress })}`}
                                        </span>
                                        {v.error_message && (
                                            <p className="mt-0.5 text-xs text-red-600">
                                                {v.error_message}
                                            </p>
                                        )}
                                    </td>
                                    <td className="py-3 pr-4">
                                        {v.duration_seconds
                                            ? t('table.durationSeconds', {
                                                  count: Math.round(v.duration_seconds),
                                              })
                                            : t('table.noValue')}
                                    </td>
                                    <td className="py-3 pr-4 text-muted-foreground">
                                        {formatDate(v.created_at) ?? t('table.noValue')}
                                    </td>
                                    <td className="py-3 pr-4">
                                        {v.status === 'COMPLETED' && v.context_json_url && (
                                            <a
                                                href={v.context_json_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                                            >
                                                context.json
                                                <ArrowSquareOut className="size-3" />
                                            </a>
                                        )}
                                    </td>
                                    <td className="py-3">
                                        <button
                                            onClick={() => handleDelete(v.id, v.name)}
                                            className="text-muted-foreground hover:text-red-600"
                                            title={t('table.deleteTooltip')}
                                        >
                                            <Trash className="size-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Upload Dialog */}
            {showUpload && apiKey && (
                <UploadVideoDialog
                    apiKey={apiKey}
                    onClose={() => setShowUpload(false)}
                    onComplete={handleUploadComplete}
                />
            )}
        </div>
    );
}
