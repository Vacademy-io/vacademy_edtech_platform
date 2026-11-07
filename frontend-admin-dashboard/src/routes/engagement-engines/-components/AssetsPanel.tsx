import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    FileText,
    Image as ImageIcon,
    LinkSimple,
    MusicNotes,
    PencilSimple,
    Trash,
    UploadSimple,
    VideoCamera,
    Warning,
    FolderOpen,
    Plus,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDialog } from '@/components/design-system/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { getInstituteId } from '@/constants/helper';
import { getChatUser } from '@/services/chat/getChatUser';
import { getPublicUrl, UploadFileInS3 } from '@/services/upload_file';
import { IconTile } from './engine-ui';
import { ConfirmDialog } from './ConfirmDialog';
import { useAssets, useAssetsMutations } from '../-hooks/assets';
import {
    checkAssetsFile,
    formatBytes,
    isHttpsUrl,
    toAssetRequest,
    ASSETS_DESCRIPTION_MAX,
    ASSETS_MAX_ITEMS,
    ASSETS_TITLE_MAX,
    type EngineAsset,
    type AssetDraftItem,
    type AssetMediaType,
} from '../-types/assets';

const MEDIA_ICON: Record<AssetMediaType, Icon> = {
    document: FileText,
    image: ImageIcon,
    video: VideoCamera,
    audio: MusicNotes,
    link: LinkSimple,
};

const MEDIA_TINT: Record<AssetMediaType, string> = {
    document: 'bg-info-50 text-info-600',
    image: 'bg-success-50 text-success-600',
    video: 'bg-warning-50 text-warning-600',
    audio: 'bg-primary-50 text-primary-500',
    link: 'bg-neutral-100 text-neutral-600',
};

const ACCEPT_ATTR =
    'application/pdf,image/*,video/*,audio/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';

type DialogState =
    | { kind: 'file'; file: File }
    | { kind: 'link' }
    | { kind: 'edit'; item: AssetDraftItem }
    | null;

const newKey = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const stripExtension = (name: string) => name.replace(/\.[^./\\]+$/, '').replace(/[_-]+/g, ' ');

export interface AssetsPanelProps {
    /** Live mode: the engine exists, items are saved straight to it. */
    engineId?: string;
    /** Local mode (no engineId): items are held by the caller until the engine is created. */
    items?: AssetDraftItem[];
    onItemsChange?: (items: AssetDraftItem[]) => void;
}

/**
 * The engine's assets of sendable material. Works on caller-held state while the engine is
 * being created, and on the live endpoints once it exists.
 */
export function AssetsPanel({ engineId, items, onItemsChange }: AssetsPanelProps) {
    const { t } = useTranslation('engagementEnginesAssets');
    const live = !!engineId;
    const query = useAssets(engineId);
    const mutations = useAssetsMutations(engineId ?? '');
    const fileInput = useRef<HTMLInputElement>(null);
    const [dialog, setDialog] = useState<DialogState>(null);
    const [removing, setRemoving] = useState<AssetDraftItem | null>(null);

    const list: AssetDraftItem[] = useMemo(
        () =>
            live
                ? (query.data ?? []).map((a: EngineAsset) => ({ ...a, key: a.id, id: a.id }))
                : items ?? [],
        [live, query.data, items]
    );
    const atLimit = list.length >= ASSETS_MAX_ITEMS;

    const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const check = checkAssetsFile(file);
        if (!check.ok) {
            toast.error(
                check.reason === 'unsupported'
                    ? t('errors.unsupported')
                    : t('errors.tooLarge', {
                          kind: t(`kind.${check.mediaType}`),
                          mb: check.limitMb,
                      })
            );
            return;
        }
        setDialog({ kind: 'file', file });
    };

    const save = async (item: AssetDraftItem) => {
        const body = toAssetRequest(item);
        if (live && engineId) {
            if (item.id) await mutations.update.mutateAsync({ assetId: item.id, body });
            else await mutations.add.mutateAsync(body);
        } else if (item.id || list.some((i) => i.key === item.key)) {
            onItemsChange?.(list.map((i) => (i.key === item.key ? item : i)));
        } else {
            onItemsChange?.([...list, item]);
        }
    };

    const remove = async (item: AssetDraftItem) => {
        if (live && item.id) await mutations.remove.mutateAsync(item.id);
        else onItemsChange?.(list.filter((i) => i.key !== item.key));
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-caption text-neutral-500">
                    {t('hint', { max: ASSETS_MAX_ITEMS })}
                </p>
                <div className="flex shrink-0 flex-wrap gap-2">
                    <input
                        ref={fileInput}
                        type="file"
                        accept={ACCEPT_ATTR}
                        className="hidden"
                        onChange={onPickFile}
                    />
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        disable={atLimit}
                        onClick={() => fileInput.current?.click()}
                    >
                        <UploadSimple size={14} aria-hidden />
                        {t('actions.uploadFile')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={atLimit}
                        onClick={() => setDialog({ kind: 'link' })}
                    >
                        <LinkSimple size={14} aria-hidden />
                        {t('actions.addLink')}
                    </MyButton>
                </div>
            </div>
            {atLimit && (
                <p className="text-caption text-warning-700">
                    {t('limitReached', { max: ASSETS_MAX_ITEMS })}
                </p>
            )}

            {live && query.isLoading ? (
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            ) : live && query.isError ? (
                <div className="flex flex-col items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3">
                    <p className="text-body text-danger-700">{t('loadFailed')}</p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => query.refetch()}
                    >
                        {t('actions.retry')}
                    </MyButton>
                </div>
            ) : list.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 p-6 text-center">
                    <IconTile icon={FolderOpen} tint="bg-neutral-100 text-neutral-600" />
                    <p className="text-subtitle font-semibold text-neutral-800">
                        {t('empty.title')}
                    </p>
                    <p className="max-w-lg text-body text-neutral-500">{t('empty.text')}</p>
                </div>
            ) : (
                <ul className="flex flex-col gap-2">
                    {list.map((item) => (
                        <AssetsRow
                            key={item.key}
                            item={item}
                            t={t}
                            onEdit={() => setDialog({ kind: 'edit', item })}
                            onRemove={() => setRemoving(item)}
                        />
                    ))}
                </ul>
            )}

            {dialog && (
                <AssetsItemDialog
                    state={dialog}
                    onClose={() => setDialog(null)}
                    onSave={async (item) => {
                        await save(item);
                        setDialog(null);
                    }}
                />
            )}

            <ConfirmDialog
                open={!!removing}
                onOpenChange={(o) => !o && setRemoving(null)}
                title={t('remove.title')}
                description={t('remove.description', { title: removing?.title ?? '' })}
                confirmLabel={t('remove.confirm')}
                cancelLabel={t('remove.cancel')}
                onConfirm={() => removing && remove(removing)}
            />
        </div>
    );
}

function AssetsRow({
    item,
    t,
    onEdit,
    onRemove,
}: {
    item: AssetDraftItem;
    t: (key: string, opts?: Record<string, unknown>) => string;
    onEdit: () => void;
    onRemove: () => void;
}) {
    const meta = [item.filename, formatBytes(item.sizeBytes)].filter(Boolean).join(' · ');
    return (
        <li className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3">
            <IconTile
                icon={MEDIA_ICON[item.mediaType]}
                size="sm"
                tint={MEDIA_TINT[item.mediaType]}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate text-body font-semibold text-neutral-800">{item.title}</p>
                {meta && <p className="truncate text-caption text-neutral-500">{meta}</p>}
                {item.mediaType === 'link' && (
                    <p className="truncate text-caption text-neutral-500">{item.url}</p>
                )}
                {item.description?.trim() ? (
                    <p className="line-clamp-2 text-caption text-neutral-600">{item.description}</p>
                ) : (
                    <p className="flex items-center gap-1 text-caption text-warning-700">
                        <Warning size={12} weight="bold" aria-hidden />
                        {t('noDescriptionWarning')}
                    </p>
                )}
            </div>
            <div className="flex shrink-0 gap-1">
                <MyButton
                    type="button"
                    buttonType="text"
                    layoutVariant="icon"
                    scale="small"
                    aria-label={t('actions.edit')}
                    onClick={onEdit}
                >
                    <PencilSimple size={14} aria-hidden />
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="text"
                    layoutVariant="icon"
                    scale="small"
                    aria-label={t('actions.remove')}
                    onClick={onRemove}
                >
                    <Trash size={14} aria-hidden />
                </MyButton>
            </div>
        </li>
    );
}

function AssetsItemDialog({
    state,
    onClose,
    onSave,
}: {
    state: Exclude<DialogState, null>;
    onClose: () => void;
    onSave: (item: AssetDraftItem) => Promise<void>;
}) {
    const { t } = useTranslation('engagementEnginesAssets');
    const existing = state.kind === 'edit' ? state.item : null;
    const [title, setTitle] = useState(
        existing?.title ?? (state.kind === 'file' ? stripExtension(state.file.name) : '')
    );
    const [description, setDescription] = useState(existing?.description ?? '');
    const [url, setUrl] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [, setUploading] = useState(false);

    const urlInvalid = state.kind === 'link' && url.trim() !== '' && !isHttpsUrl(url);
    const canSave = !!title.trim() && (state.kind !== 'link' || isHttpsUrl(url));

    const submit = async () => {
        setError(null);
        try {
            if (state.kind === 'edit') {
                await onSave({ ...state.item, title, description });
            } else if (state.kind === 'link') {
                await onSave({
                    key: newKey(),
                    title,
                    description,
                    mediaType: 'link',
                    url: url.trim(),
                });
            } else {
                const { file } = state;
                const check = checkAssetsFile(file);
                if (!check.ok) return;
                // Public so WhatsApp's servers can fetch the file by link.
                const fileId = await UploadFileInS3(
                    file,
                    setUploading,
                    getChatUser().userId,
                    'ENGAGEMENT_ASSETS',
                    getInstituteId() || '',
                    true
                );
                const publicUrl = fileId ? await getPublicUrl(fileId) : '';
                if (!fileId || !publicUrl) {
                    setError(t('errors.uploadFailed'));
                    return;
                }
                await onSave({
                    key: newKey(),
                    title,
                    description,
                    mediaType: check.mediaType,
                    url: publicUrl,
                    fileId,
                    filename: file.name,
                    mimeType: file.type,
                    sizeBytes: file.size,
                });
            }
        } catch {
            setError(state.kind === 'file' ? t('errors.uploadFailed') : t('errors.saveFailed'));
        }
    };

    const heading =
        state.kind === 'edit'
            ? t('dialog.editHeading')
            : state.kind === 'link'
              ? t('dialog.linkHeading')
              : t('dialog.fileHeading');

    return (
        <MyDialog
            heading={heading}
            open
            onOpenChange={(o) => !o && onClose()}
            dialogWidth="max-w-lg"
        >
            <div className="flex flex-col gap-4 p-1">
                {state.kind === 'file' && (
                    <p className="truncate text-caption text-neutral-500">
                        {state.file.name} · {formatBytes(state.file.size)}
                    </p>
                )}
                <MyInput
                    label={t('dialog.title')}
                    required
                    inputType="text"
                    inputPlaceholder={t('dialog.titlePlaceholder')}
                    input={title}
                    maxLength={ASSETS_TITLE_MAX}
                    className="w-full sm:w-full"
                    onChangeFunction={(e) => setTitle(e.target.value)}
                />
                {state.kind === 'link' && (
                    <MyInput
                        label={t('dialog.url')}
                        required
                        inputType="url"
                        inputPlaceholder="https://"
                        input={url}
                        className="w-full sm:w-full"
                        error={urlInvalid ? t('errors.httpsOnly') : null}
                        onChangeFunction={(e) => setUrl(e.target.value)}
                    />
                )}
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="assets-description">{t('dialog.description')}</Label>
                    <Textarea
                        id="assets-description"
                        rows={4}
                        value={description}
                        maxLength={ASSETS_DESCRIPTION_MAX}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('dialog.descriptionPlaceholder')}
                    />
                    <p className="text-caption text-neutral-500">{t('dialog.descriptionHint')}</p>
                    {!description.trim() && (
                        <p className="flex items-center gap-1 text-caption text-warning-700">
                            <Warning size={12} weight="bold" aria-hidden />
                            {t('noDescriptionWarning')}
                        </p>
                    )}
                </div>
                {error && <p className="text-body text-danger-600">{error}</p>}
                <div className="flex justify-end gap-2">
                    <MyButton type="button" buttonType="secondary" scale="small" onClick={onClose}>
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        disable={!canSave}
                        onAsyncClick={submit}
                    >
                        {state.kind === 'edit' ? (
                            t('dialog.save')
                        ) : (
                            <>
                                <Plus size={14} aria-hidden />
                                {t('dialog.add')}
                            </>
                        )}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}
