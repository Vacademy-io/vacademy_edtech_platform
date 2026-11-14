import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FilmStrip as Film, Image as ImageIcon, CircleNotch as Loader2, Microphone as Mic, Monitor, UploadSimple as Upload } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import type { InputAssetKind, InputAssetMode } from '../../-services/input-asset';
import { IndexedVideoItem } from './ContextTray';

interface SourceVideoPopoverProps {
    apiKey?: string | null;
    indexedVideos: IndexedVideoItem[];
    processingVideos: IndexedVideoItem[];
    selectedIds: string[];
    onAddVideo: (id: string) => void;
    onRefresh: () => void;
    /** Disable interaction (e.g. while a generation is in flight). */
    disabled?: boolean;
}

const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024; // 500MB
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
// Mirrors the server caps (MAX_INPUT_ASSETS / MAX_INPUT_VIDEOS) and the
// composer's. Videos are the expensive kind — a large download plus an index
// job each — while an image costs one metadata JSON, so a screenshot-led
// walkthrough gets the wider ceiling. A flat 10 here capped an image run at
// half the assets the server would happily accept.
const MAX_SELECTED_ASSETS = 20;
const MAX_SELECTED_VIDEOS = 5;

export function SourceVideoPopover({
    apiKey,
    indexedVideos,
    processingVideos,
    selectedIds,
    onAddVideo,
    onRefresh,
    disabled,
}: SourceVideoPopoverProps) {
    const { t } = useTranslation('videoApiStudioSourceVideoPopover');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { uploadFile, getPublicUrl } = useFileUpload();

    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [pendingKind, setPendingKind] = useState<InputAssetKind>('video');
    const [pendingName, setPendingName] = useState('');
    const [pendingMode, setPendingMode] = useState<InputAssetMode>('demo');
    const [isUploading, setIsUploading] = useState(false);

    const availableVideos = indexedVideos.filter((v) => !selectedIds.includes(v.id));
    const totalActive = selectedIds.length + processingVideos.length;
    const atSelectionLimit = selectedIds.length >= MAX_SELECTED_ASSETS;
    const selectedVideoCount = selectedIds.filter(
        (id) => indexedVideos.find((v) => v.id === id)?.kind !== 'image'
    ).length;
    const atVideoLimit = selectedVideoCount >= MAX_SELECTED_VIDEOS;
    // An image never trips the video cap, so a run of screenshots keeps going
    // after five videos would have stopped.
    const isBlocked = (kind?: string) => atSelectionLimit || (kind !== 'image' && atVideoLimit);

    const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        if (ACCEPTED_VIDEO_TYPES.includes(file.type)) {
            if (file.size > MAX_VIDEO_SIZE_BYTES) {
                toast.error(t('errors.videoTooLarge'));
                return;
            }
            setPendingKind('video');
            setPendingMode('demo');
        } else if (ACCEPTED_IMAGE_TYPES.includes(file.type)) {
            if (file.size > MAX_IMAGE_SIZE_BYTES) {
                toast.error(t('errors.imageTooLarge'));
                return;
            }
            setPendingKind('image');
            setPendingMode('photo');
        } else {
            toast.error(t('errors.unsupportedFormat'));
            return;
        }

        setPendingFile(file);
        setPendingName(file.name.replace(/\.[^.]+$/, ''));
    };

    const handleUploadConfirm = async () => {
        if (!pendingFile || !apiKey || !pendingName.trim()) return;
        setIsUploading(true);
        try {
            const fileId = await uploadFile({
                file: pendingFile,
                setIsUploading: () => {},
                userId: getUserId(),
                source: pendingKind === 'image' ? 'AI_INPUT_IMAGE' : 'AI_INPUT_VIDEO',
                sourceId: 'ADMIN',
                publicUrl: true,
            });
            if (!fileId) throw new Error(t('errors.uploadFailed'));

            const sourceUrl = await getPublicUrl(fileId);
            if (!sourceUrl) throw new Error(t('errors.urlFailed'));

            const { createInputAsset } = await import('../../-services/input-asset');
            await createInputAsset(
                apiKey,
                {
                    name: pendingName.trim(),
                    kind: pendingKind,
                    mode: pendingMode,
                    source_url: sourceUrl,
                },
                t
            );

            toast.success(t('success.uploaded', { name: pendingName }));
            setPendingFile(null);
            setPendingName('');
            onRefresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('errors.uploadFailed'));
        } finally {
            setIsUploading(false);
        }
    };

    const handleCancelUpload = () => {
        setPendingFile(null);
        setPendingName('');
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-indigo-600"
                    title={t('trigger.title')}
                    aria-label={t('trigger.ariaLabel')}
                    disabled={disabled || !apiKey}
                >
                    <Film className="size-4" />
                    {totalActive > 0 && (
                        <Badge
                            variant="default"
                            className="absolute -end-1 -top-1 size-3.5 min-w-3.5 justify-center px-1 text-2xs"
                        >
                            {totalActive}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[calc(100vw-2rem)] max-w-xs p-3" /* design-lint-ignore: mobile-viewport popover clamp, no token exists (same pattern as add-event-dialog.tsx) */
                align="start"
                collisionPadding={16}
            >
                <div className="space-y-3">
                    <div>
                        <p className="text-xs font-semibold">{t('heading.title')}</p>
                        <p className="text-2xs text-muted-foreground">
                            {t('heading.description')}
                        </p>
                    </div>

                    {/* Processing — currently being indexed */}
                    {processingVideos.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                                {t('processing.label')}
                            </p>
                            {processingVideos.map((v) => (
                                <div
                                    key={v.id}
                                    className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs"
                                >
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="size-3 shrink-0 animate-spin text-indigo-500" />
                                        <span className="flex-1 truncate">{v.name}</span>
                                        <span className="shrink-0 text-muted-foreground">
                                            {v.progress ?? 0}%
                                        </span>
                                    </div>
                                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                                        <div
                                            className="h-full rounded-full bg-indigo-500 transition-all"
                                            style={{ width: `${v.progress ?? 0}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Available — completed and not yet selected */}
                    {availableVideos.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                                {t('available.label')}
                            </p>
                            <div className="max-h-40 space-y-0.5 overflow-y-auto">
                                {availableVideos.map((v) => (
                                    <button
                                        key={v.id}
                                        type="button"
                                        disabled={isBlocked(v.kind)}
                                        onClick={() => onAddVideo(v.id)}
                                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <span className="text-muted-foreground">+</span>
                                        {v.kind === 'image' ? (
                                            <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
                                        ) : (
                                            <Film className="size-3 shrink-0 text-muted-foreground" />
                                        )}
                                        <span className="flex-1 truncate">{v.name}</span>
                                        <span className="shrink-0 text-muted-foreground">
                                            {t(`modes.${v.mode}`)}
                                            {v.duration_seconds
                                                ? ` · ${t('available.durationSeconds', { seconds: Math.round(v.duration_seconds) })}`
                                                : ''}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {availableVideos.length === 0 &&
                        processingVideos.length === 0 &&
                        indexedVideos.length > 0 && (
                            <p className="py-1 text-center text-xs text-muted-foreground">
                                {t('available.allSelected')}
                            </p>
                        )}
                    {(atSelectionLimit || atVideoLimit) && (
                        <p className="text-xs text-muted-foreground">
                            {t('limit.message', {
                                count: atSelectionLimit ? MAX_SELECTED_ASSETS : MAX_SELECTED_VIDEOS,
                            })}
                        </p>
                    )}

                    {/* Upload section */}
                    <div className="space-y-2 border-t pt-2">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/mp4,video/webm,video/quicktime,image/png,image/jpeg,image/webp,.mp4,.webm,.mov,.png,.jpg,.jpeg,.webp"
                            className="hidden"
                            onChange={handleFilePick}
                        />

                        {pendingFile ? (
                            <div className="space-y-2">
                                <input
                                    type="text"
                                    value={pendingName}
                                    onChange={(e) => setPendingName(e.target.value)}
                                    className="w-full rounded-md border px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
                                    placeholder={t('upload.namePlaceholder')}
                                />
                                <div className="flex flex-wrap items-center gap-1">
                                    <span className="text-2xs text-muted-foreground">
                                        {t('upload.typeLabel')}
                                    </span>
                                    {pendingKind === 'video' ? (
                                        <>
                                            <ModeButton
                                                active={pendingMode === 'demo'}
                                                onClick={() => setPendingMode('demo')}
                                                Icon={Monitor}
                                                label={t('modes.demo')}
                                            />
                                            <ModeButton
                                                active={pendingMode === 'podcast'}
                                                onClick={() => setPendingMode('podcast')}
                                                Icon={Mic}
                                                label={t('modes.podcast')}
                                            />
                                        </>
                                    ) : (
                                        (['photo', 'screenshot', 'diagram'] as const).map((m) => (
                                            <ModeButton
                                                key={m}
                                                active={pendingMode === m}
                                                onClick={() => setPendingMode(m)}
                                                Icon={ImageIcon}
                                                label={t(`modes.${m}`)}
                                            />
                                        ))
                                    )}
                                </div>
                                <div className="flex gap-1.5">
                                    <button
                                        type="button"
                                        onClick={handleUploadConfirm}
                                        disabled={isUploading || !pendingName.trim()}
                                        className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                                    >
                                        {isUploading ? (
                                            <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                            <Upload className="size-3" />
                                        )}
                                        {isUploading ? t('upload.uploading') : t('upload.confirm')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCancelUpload}
                                        disabled={isUploading}
                                        className="rounded-md border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                                    >
                                        {t('upload.cancel')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed p-2 text-xs text-muted-foreground transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 hover:text-indigo-700 dark:hover:bg-indigo-950/30"
                            >
                                <Upload className="size-3.5" />
                                {t('upload.dropCta')}
                            </button>
                        )}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function ModeButton({
    active,
    onClick,
    Icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    Icon: typeof Mic;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                active
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                    : 'text-muted-foreground hover:bg-muted'
            }`}
        >
            <Icon className="size-3" />
            {label}
        </button>
    );
}
