import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AlertCircle,
    CheckCircle2,
    Clapperboard,
    Clock,
    FolderOpen,
    Image as ImageIcon,
    Mic,
    Monitor,
    Upload,
    X,
} from 'lucide-react';
import { VimotionLoader } from '../brand/VimotionLoader';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import { getUserId } from '@/utils/userDetails';
import { useFileUpload } from '@/hooks/use-file-upload';
import {
    createInputAsset,
    listInputAssets,
    type InputAssetKind,
    type InputAssetMode,
    type InputAssetRecord,
    type InputAssetStatus,
} from '@/routes/video-api-studio/-services/input-asset';
import { useVimotionApiKey } from './hooks/useVimotionApiKey';
import { AssetDetailPanel } from './AssetDetailPanel';

type Filter = 'all' | 'video' | 'image';

const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024; // 500MB
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/** Filename without its extension — the default asset name for a picked file. */
const stripExt = (filename: string) => filename.replace(/\.[^.]+$/, '');

export function AssetsTab() {
    const instituteId = getInstituteId();
    const apiKey = useVimotionApiKey(instituteId);
    const [filter, setFilter] = useState<Filter>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [uploadOpen, setUploadOpen] = useState(false);

    const assetsQuery = useQuery({
        queryKey: ['input-assets', instituteId, apiKey.data],
        queryFn: () => listInputAssets(apiKey.data!),
        enabled: !!apiKey.data,
        staleTime: 15_000,
        // Poll while anything is processing so progress bars advance.
        refetchInterval: (query) => {
            const data = query.state.data;
            const hasActive = data?.some((a) =>
                ['PENDING', 'QUEUED', 'PROCESSING'].includes(a.status)
            );
            return hasActive ? 5_000 : false;
        },
    });

    const filteredAssets = useMemo(() => {
        const data = assetsQuery.data ?? [];
        if (filter === 'all') return data;
        return data.filter((a) => a.kind === filter);
    }, [assetsQuery.data, filter]);

    const selected = useMemo(
        () => assetsQuery.data?.find((a) => a.id === selectedId) ?? null,
        [assetsQuery.data, selectedId]
    );

    if (apiKey.isError) {
        return <ErrorState message="Could not connect to the video service. Please try again." />;
    }

    return (
        <div className="space-y-5">
            {/* Toolbar: filter chips + upload */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                    <FilterChip current={filter} value="all" onClick={setFilter}>
                        All
                    </FilterChip>
                    <FilterChip current={filter} value="video" onClick={setFilter}>
                        Videos
                    </FilterChip>
                    <FilterChip current={filter} value="image" onClick={setFilter}>
                        Images
                    </FilterChip>
                </div>
                <button
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    disabled={!apiKey.data}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md bg-neutral-900 px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Upload className="size-4" />
                    Upload
                </button>
            </div>

            {/* Grid */}
            {apiKey.isLoading || assetsQuery.isLoading ? (
                <LoadingGrid />
            ) : assetsQuery.isError ? (
                <ErrorState message="Could not load your assets. Please refresh." />
            ) : filteredAssets.length === 0 ? (
                <EmptyState onUpload={() => setUploadOpen(true)} hasAny={!!assetsQuery.data?.length} filter={filter} />
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredAssets.map((asset) => (
                        <AssetCard
                            key={asset.id}
                            asset={asset}
                            onClick={() => setSelectedId(asset.id)}
                        />
                    ))}
                </div>
            )}

            {/* Detail panel */}
            {selected && (
                <AssetDetailPanel
                    asset={selected}
                    apiKey={apiKey.data!}
                    onClose={() => setSelectedId(null)}
                />
            )}

            {/* Upload modal */}
            {uploadOpen && apiKey.data && (
                <UploadModal apiKey={apiKey.data} onClose={() => setUploadOpen(false)} />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Filter chip
// ---------------------------------------------------------------------------

function FilterChip({
    current,
    value,
    onClick,
    children,
}: {
    current: Filter;
    value: Filter;
    onClick: (v: Filter) => void;
    children: React.ReactNode;
}) {
    const active = current === value;
    return (
        <button
            type="button"
            onClick={() => onClick(value)}
            className={cn(
                'inline-flex min-h-[36px] items-center rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
                active
                    ? 'bg-neutral-900 text-white'
                    : 'bg-white text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50'
            )}
        >
            {children}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Asset card
// ---------------------------------------------------------------------------

function AssetCard({ asset, onClick }: { asset: InputAssetRecord; onClick: () => void }) {
    const isImage = asset.kind === 'image';
    const isCompleted = asset.status === 'COMPLETED';
    // The poller stores the public source URL inside assets_urls under
    // `source_image` (image kind) or `source_video` (video kind). Fall back
    // to source_url for older rows that pre-date the public re-upload.
    const previewUrl =
        (isImage ? asset.assets_urls?.source_image : asset.assets_urls?.source_video) ??
        asset.source_url;

    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-colors hover:border-neutral-300"
        >
            <div className="relative aspect-video w-full bg-neutral-100">
                {isImage && previewUrl && isCompleted ? (
                    <img
                        src={previewUrl}
                        alt={asset.name}
                        className="size-full object-cover"
                        loading="lazy"
                    />
                ) : !isImage && previewUrl && isCompleted ? (
                    // Browser auto-shows a poster frame for muted preload="metadata" videos.
                    <video
                        src={previewUrl}
                        muted
                        preload="metadata"
                        className="size-full object-cover"
                    />
                ) : (
                    <div className="flex size-full items-center justify-center text-neutral-400">
                        {isImage ? (
                            <ImageIcon className="size-8" />
                        ) : (
                            <Clapperboard className="size-8" />
                        )}
                    </div>
                )}
                <StatusBadge status={asset.status} progress={asset.progress} />
                <KindBadge kind={asset.kind} mode={asset.mode} />
            </div>
            <div className="flex flex-col gap-1 p-3.5">
                <p className="line-clamp-2 text-sm font-medium text-neutral-900">{asset.name}</p>
                <p className="text-xs text-neutral-500">{describeAsset(asset)}</p>
            </div>
        </button>
    );
}

function describeAsset(asset: InputAssetRecord): string {
    const parts: string[] = [];
    if (asset.kind === 'video' && asset.duration_seconds) {
        parts.push(`${Math.round(asset.duration_seconds)}s`);
    }
    if (asset.kind === 'image' && asset.width && asset.height) {
        parts.push(`${asset.width}×${asset.height}`);
    }
    if (asset.created_at) parts.push(formatTimestamp(asset.created_at));
    return parts.join(' · ');
}

function StatusBadge({ status, progress }: { status: InputAssetStatus; progress: number }) {
    const config: Record<InputAssetStatus, { label: string; Icon: typeof CheckCircle2; cls: string }> = {
        COMPLETED: {
            label: 'Ready',
            Icon: CheckCircle2,
            cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        },
        PROCESSING: {
            label: `${progress || 0}%`,
            Icon: CheckCircle2,
            cls: 'bg-blue-50 text-blue-700 border-blue-200',
        },
        QUEUED: {
            label: 'Queued',
            Icon: Clock,
            cls: 'bg-neutral-50 text-neutral-700 border-neutral-200',
        },
        PENDING: {
            label: 'Pending',
            Icon: Clock,
            cls: 'bg-neutral-50 text-neutral-700 border-neutral-200',
        },
        FAILED: {
            label: 'Failed',
            Icon: AlertCircle,
            cls: 'bg-red-50 text-red-700 border-red-200',
        },
    };
    const { label, Icon, cls } = config[status];
    const spinning = status === 'PROCESSING';
    return (
        <span
            className={cn(
                'absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                cls
            )}
        >
            {spinning ? (
                <VimotionLoader size={12} className="text-blue-700" label="Processing" />
            ) : (
                <Icon className="size-3" />
            )}
            {label}
        </span>
    );
}

function KindBadge({ kind, mode }: { kind: InputAssetKind; mode: InputAssetMode }) {
    return (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
            {kind === 'image' ? <ImageIcon className="size-3" /> : <Clapperboard className="size-3" />}
            {mode}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Upload modal
// ---------------------------------------------------------------------------

function UploadModal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const queryClient = useQueryClient();
    const { uploadFile, getPublicUrl } = useFileUpload();

    // One row per picked file. A batch uploads sequentially and each row carries
    // its own outcome, so one rejected file does not discard the rest of a
    // 16-screenshot selection the user just spent time assembling.
    type Row = {
        file: File;
        name: string;
        kind: InputAssetKind;
        status: 'pending' | 'uploading' | 'done' | 'error';
        error?: string;
    };

    const [rows, setRows] = useState<Row[]>([]);
    const [videoMode, setVideoMode] = useState<'demo' | 'podcast'>('demo');
    const [imageMode, setImageMode] = useState<InputAssetMode>('photo');
    const [busy, setBusy] = useState(false);

    const hasVideo = rows.some((r) => r.kind === 'video');
    const hasImage = rows.some((r) => r.kind === 'image');
    const doneCount = rows.filter((r) => r.status === 'done').length;
    const canUpload =
        rows.length > 0 &&
        rows.every((r) => r.name.trim()) &&
        rows.some((r) => r.status !== 'done');

    const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (!picked.length) return;

        const accepted: Row[] = [];
        const rejected: string[] = [];

        for (const f of picked) {
            if (ACCEPTED_VIDEO_TYPES.includes(f.type)) {
                if (f.size > MAX_VIDEO_SIZE_BYTES) {
                    rejected.push(`${f.name} — over 500MB`);
                    continue;
                }
                accepted.push({
                    file: f,
                    name: stripExt(f.name),
                    kind: 'video',
                    status: 'pending',
                });
            } else if (ACCEPTED_IMAGE_TYPES.includes(f.type)) {
                if (f.size > MAX_IMAGE_SIZE_BYTES) {
                    rejected.push(`${f.name} — over 10MB`);
                    continue;
                }
                accepted.push({
                    file: f,
                    name: stripExt(f.name),
                    kind: 'image',
                    status: 'pending',
                });
            } else {
                rejected.push(`${f.name} — unsupported format`);
            }
        }

        // Append rather than replace, so a second pick adds to the batch.
        // De-duplicated on name+size: re-picking the same folder is an easy way
        // to end up indexing — and paying for — the same still twice.
        if (accepted.length) {
            setRows((prev) => {
                const seen = new Set(prev.map((r) => `${r.file.name}:${r.file.size}`));
                return [
                    ...prev,
                    ...accepted.filter((r) => !seen.has(`${r.file.name}:${r.file.size}`)),
                ];
            });
        }
        if (rejected.length) {
            toast.error(
                rejected.length === 1
                    ? `Skipped ${rejected[0]}`
                    : `Skipped ${rejected.length} files: ${rejected.slice(0, 3).join('; ')}`
            );
        }
    };

    const setRow = (idx: number, patch: Partial<Row>) =>
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

    const handleUpload = async () => {
        if (!canUpload) return;
        setBusy(true);

        let ok = 0;
        const failed: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.status === 'done') continue;

            const mode: InputAssetMode =
                row.kind === 'video' ? videoMode : (imageMode as InputAssetMode);

            setRow(i, { status: 'uploading', error: undefined });
            try {
                const fileId = await uploadFile({
                    file: row.file,
                    setIsUploading: () => {},
                    userId: getUserId(),
                    source: row.kind === 'video' ? 'AI_INPUT_VIDEO' : 'AI_INPUT_IMAGE',
                    sourceId: 'ADMIN',
                    publicUrl: true,
                });
                if (!fileId) throw new Error('Upload failed');
                const sourceUrl = await getPublicUrl(fileId);
                if (!sourceUrl) throw new Error('Failed to get URL');

                await createInputAsset(apiKey, {
                    name: row.name.trim(),
                    kind: row.kind,
                    mode,
                    source_url: sourceUrl,
                });
                setRow(i, { status: 'done' });
                ok++;
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Upload failed';
                setRow(i, { status: 'error', error: message });
                failed.push(row.name);
            }
        }

        queryClient.invalidateQueries({ queryKey: ['input-assets'] });
        setBusy(false);

        if (ok) toast.success(`${ok} asset${ok === 1 ? '' : 's'} uploaded — indexing started`);
        if (failed.length) {
            // Leave the modal open: failed rows keep their names and can be
            // retried without re-picking the whole batch.
            toast.error(`${failed.length} failed. Press Upload again to retry.`);
        } else {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={busy ? undefined : onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-neutral-900">
                        {rows.length > 1 ? `Upload ${rows.length} assets` : 'Upload asset'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="video/mp4,video/webm,video/quicktime,image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleFilePick}
                />

                {!rows.length ? (
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-10 text-sm text-neutral-600 transition-colors hover:border-neutral-400 hover:bg-neutral-100"
                    >
                        <Upload className="size-6 text-neutral-400" />
                        <span className="font-medium">Choose files</span>
                        <span className="text-xs text-neutral-500">
                            Video: MP4 / WebM / MOV · max 500MB
                        </span>
                        <span className="text-xs text-neutral-500">
                            Image: PNG / JPEG / WebP · max 10MB
                        </span>
                        <span className="text-xs text-neutral-400">Select several at once</span>
                    </button>
                ) : (
                    <div className="mt-4 space-y-4">
                        <div className="space-y-1.5">
                            {rows.map((row, i) => (
                                <div
                                    key={`${row.file.name}:${row.file.size}`}
                                    className="flex items-center gap-2 rounded-md bg-neutral-50 px-2 py-1.5 text-sm"
                                >
                                    {row.status === 'done' ? (
                                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                                    ) : row.status === 'error' ? (
                                        <AlertCircle className="size-4 shrink-0 text-red-500" />
                                    ) : row.status === 'uploading' ? (
                                        <VimotionLoader size={16} label="Uploading" />
                                    ) : row.kind === 'image' ? (
                                        <ImageIcon className="size-4 shrink-0 text-neutral-500" />
                                    ) : (
                                        <Clapperboard className="size-4 shrink-0 text-neutral-500" />
                                    )}
                                    <input
                                        type="text"
                                        value={row.name}
                                        onChange={(e) => setRow(i, { name: e.target.value })}
                                        disabled={busy || row.status === 'done'}
                                        title={row.error || row.file.name}
                                        className={cn(
                                            'w-full flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm focus:border-neutral-300 focus:bg-white focus:outline-none disabled:text-neutral-500',
                                            !row.name.trim() && 'border-red-300'
                                        )}
                                        placeholder="Asset name"
                                    />
                                    {!busy && row.status !== 'done' && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setRows((prev) => prev.filter((_, j) => j !== i))
                                            }
                                            className="shrink-0 text-neutral-400 hover:text-neutral-900"
                                            aria-label={`Remove ${row.name}`}
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                            {!busy && (
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="text-xs font-medium text-neutral-600 hover:text-neutral-900"
                                >
                                    + Add more
                                </button>
                            )}
                        </div>

                        {hasImage && (
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-neutral-700">
                                    Image type{hasVideo ? ' (applies to all images)' : ''}
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    {(['photo', 'screenshot', 'diagram'] as const).map((m) => (
                                        <ModeChip
                                            key={m}
                                            active={imageMode === m}
                                            onClick={() => setImageMode(m)}
                                            Icon={ImageIcon}
                                        >
                                            {m.charAt(0).toUpperCase() + m.slice(1)}
                                        </ModeChip>
                                    ))}
                                </div>
                            </div>
                        )}

                        {hasVideo && (
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-neutral-700">
                                    Video type{hasImage ? ' (applies to all videos)' : ''}
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    <ModeChip
                                        active={videoMode === 'demo'}
                                        onClick={() => setVideoMode('demo')}
                                        Icon={Monitor}
                                    >
                                        Demo
                                    </ModeChip>
                                    <ModeChip
                                        active={videoMode === 'podcast'}
                                        onClick={() => setVideoMode('podcast')}
                                        Icon={Mic}
                                    >
                                        Podcast
                                    </ModeChip>
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2 pt-2">
                            <button
                                type="button"
                                onClick={handleUpload}
                                disabled={busy || !canUpload}
                                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-neutral-900 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {busy ? (
                                    <VimotionLoader
                                        size={16}
                                        className="text-white"
                                        label="Uploading"
                                    />
                                ) : (
                                    <Upload className="size-4" />
                                )}
                                {busy
                                    ? `Uploading ${Math.min(doneCount + 1, rows.length)} of ${rows.length}…`
                                    : rows.length > 1
                                      ? `Upload & Index ${rows.length}`
                                      : 'Upload & Index'}
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={busy}
                                className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function ModeChip({
    active,
    onClick,
    Icon,
    children,
}: {
    active: boolean;
    onClick: () => void;
    Icon: typeof Mic;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                active
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-50 text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-100'
            )}
        >
            <Icon className="size-3" />
            {children}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Empty / loading / error
// ---------------------------------------------------------------------------

function EmptyState({
    onUpload,
    hasAny,
    filter,
}: {
    onUpload: () => void;
    hasAny: boolean;
    filter: Filter;
}) {
    if (hasAny && filter !== 'all') {
        return (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
                No {filter}s yet — try a different filter or upload one.
            </div>
        );
    }
    return (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-neutral-50 ring-1 ring-neutral-200">
                <FolderOpen className="size-5 text-primary-500" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-neutral-900">No assets yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
                Upload videos (podcasts, demos) or images (photos, screenshots, diagrams) — we
                index them so you can drop them into any generated video.
            </p>
            <button
                type="button"
                onClick={onUpload}
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-neutral-900 px-5 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
            >
                <Upload className="size-4" />
                Upload your first asset
            </button>
        </div>
    );
}

function LoadingGrid() {
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
                    <div className="aspect-video w-full animate-pulse bg-neutral-100" />
                    <div className="space-y-2 p-3.5">
                        <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
                        <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function ErrorState({ message }: { message: string }) {
    return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            <div className="flex items-center gap-2 font-medium">
                <AlertCircle className="size-4" />
                {message}
            </div>
        </div>
    );
}

function formatTimestamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const now = Date.now();
    const diffSec = Math.floor((now - date.getTime()) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
