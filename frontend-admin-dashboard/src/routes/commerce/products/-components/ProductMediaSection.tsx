import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowLeft,
    ArrowRight,
    Image as ImageIcon,
    Trash,
    UploadSimple,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PlainSelect, SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import {
    CommerceErrorState,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { readImageSize } from '@/routes/manage-pages/-utils/image-prep';
import {
    useMediaMutations,
    useMediaTags,
    useProductMedia,
} from '@/routes/commerce/-shared/catalogue-hooks';
import {
    PRODUCT_LOCALES,
    type ProductDetail,
    type ProductMedia,
} from '@/routes/commerce/-shared/catalogue-types';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import {
    renditionError,
    renditionFor,
    renditionStatus,
} from '@/routes/commerce/-shared/media-renditions';
import { mediaTagLabel, offeredMediaTags } from './media-tags';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPLOAD_SOURCE = 'COMMERCE_PRODUCT_MEDIA';
/** Width of the rendition asked for the gallery thumbnail (drawn at 96 px, 2x screens). */
const THUMBNAIL_WIDTH = 320;

/**
 * Photos of the product: upload (through the dashboard's upload flow, into
 * the media service), order them (the first is the cover), tag, alt text in
 * both languages, tie a photo to one variant, remove. Each change is saved at
 * once; it is not part of the editor's Save.
 */
export function ProductMediaSection({ product }: { product: ProductDetail | null }) {
    const { t } = useTranslation('commerce');
    return (
        <SectionCard
            title={t('products.media.title')}
            description={t('products.media.description')}
        >
            {product ? (
                <MediaGallery product={product} />
            ) : (
                <p className="rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                    {t('products.media.saveFirst')}
                </p>
            )}
        </SectionCard>
    );
}

function MediaGallery({ product }: { product: ProductDetail }) {
    const { t } = useTranslation('commerce');
    const packageId = product.package_id;
    const query = useProductMedia(packageId);
    const mutations = useMediaMutations(packageId);
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
    const media = query.data ?? [];

    const upload = async (files: File[]) => {
        const images = files.filter((file) => file.type.startsWith('image/'));
        if (images.length < files.length) toast.error(t('products.media.onlyImages'));
        if (images.length === 0) return;
        setUploadProgress({ done: 0, total: images.length });
        let failed = 0;
        for (const file of images) {
            try {
                if (file.size > MAX_IMAGE_BYTES) throw new Error(t('products.media.tooLarge'));
                const size = await readImageSize(file);
                const mediaId = await UploadFileInS3(
                    file,
                    setUploading,
                    getUserId(),
                    UPLOAD_SOURCE,
                    packageId,
                    true
                );
                if (!mediaId) throw new Error(t('products.media.errors.upload'));
                await mutations.attach.mutateAsync({
                    media_id: mediaId,
                    kind: 'IMAGE',
                    ...(size ? { width: size.width, height: size.height } : {}),
                });
            } catch (error) {
                failed += 1;
                const fallback =
                    error instanceof Error && !('response' in error)
                        ? error.message
                        : t('products.media.errors.upload');
                toast.error(
                    t('products.media.errors.file', {
                        file: file.name,
                        reason: readCommerceError(error, fallback).message,
                    })
                );
            }
            setUploadProgress((current) => ({ ...current, done: current.done + 1 }));
        }
        setUploading(false);
        if (failed < images.length) {
            toast.success(t('products.media.toast.uploaded', { count: images.length - failed }));
        }
    };

    const move = async (index: number, by: -1 | 1) => {
        const ids = media.map((entry) => entry.id);
        const target = index + by;
        const moved = ids[index];
        const other = ids[target];
        if (!moved || !other) return;
        ids[index] = other;
        ids[target] = moved;
        try {
            await mutations.reorder.mutateAsync(ids);
        } catch (error) {
            toast.error(readCommerceError(error, t('products.media.errors.reorder')).message);
        }
    };

    const remove = async (entry: ProductMedia) => {
        if (!window.confirm(t('products.media.removeConfirm'))) return;
        try {
            await mutations.remove.mutateAsync(entry.id);
            toast.success(t('products.media.toast.removed'));
        } catch (error) {
            toast.error(readCommerceError(error, t('products.media.errors.remove')).message);
        }
    };

    const variantOptions = product.variants
        .filter((variant) => variant.status !== 'ARCHIVED')
        .map((variant) => ({
            value: variant.package_session_id,
            label: variant.name || variant.sku || variant.package_session_id,
        }));

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        event.target.value = '';
                        void upload(files);
                    }}
                />
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    type="button"
                    disable={uploading}
                    onClick={() => fileInput.current?.click()}
                >
                    <UploadSimple size={16} />
                    {uploading
                        ? t('products.media.uploading', uploadProgress)
                        : t('products.media.upload')}
                </MyButton>
                <span className="text-caption text-muted-foreground">
                    {t('products.media.uploadHint')}
                </span>
            </div>

            {query.isLoading && <Skeleton className="h-40 w-full" />}
            {query.isError && (
                <CommerceErrorState
                    message={
                        readCommerceError(query.error, t('products.media.errors.load')).message
                    }
                    onRetry={() => void query.refetch()}
                />
            )}
            {query.isSuccess && media.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-caption text-muted-foreground">
                    {t('products.media.empty')}
                </p>
            )}
            {media.length > 0 && (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {media.map((entry, index) => (
                        <MediaCard
                            key={entry.id}
                            entry={entry}
                            isCover={index === 0}
                            canMoveBack={index > 0}
                            canMoveForward={index < media.length - 1}
                            busy={mutations.reorder.isPending}
                            variantOptions={variantOptions}
                            onRetry={async () => {
                                try {
                                    await mutations.retryRendition.mutateAsync(entry.id);
                                } catch (error) {
                                    toast.error(
                                        readCommerceError(error, t('products.media.errors.retry'))
                                            .message
                                    );
                                }
                            }}
                            onMove={(by) => void move(index, by)}
                            onRemove={() => void remove(entry)}
                            onSave={async (body) => {
                                try {
                                    await mutations.update.mutateAsync({ id: entry.id, body });
                                    toast.success(t('products.media.toast.saved'));
                                } catch (error) {
                                    toast.error(
                                        readCommerceError(error, t('products.media.errors.save'))
                                            .message
                                    );
                                }
                            }}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

function MediaCard({
    entry,
    isCover,
    canMoveBack,
    canMoveForward,
    busy,
    variantOptions,
    onMove,
    onRetry,
    onRemove,
    onSave,
}: {
    entry: ProductMedia;
    isCover: boolean;
    canMoveBack: boolean;
    canMoveForward: boolean;
    busy: boolean;
    variantOptions: Array<{ value: string; label: string }>;
    onMove: (by: -1 | 1) => void;
    onRetry: () => Promise<void>;
    onRemove: () => void;
    onSave: (body: {
        tag?: string;
        alt_i18n?: Record<string, string>;
        package_session_id?: string;
    }) => Promise<void>;
}) {
    const { t } = useTranslation('commerce');
    const status = renditionStatus(entry.renditions);
    const failure = renditionError(entry.renditions);
    // A rendition is small and cacheable; until one exists the original is shown.
    const rendition = renditionFor(entry.renditions, THUMBNAIL_WIDTH);
    const original = useQuery({
        queryKey: ['commerce', 'media-url', entry.media_id],
        queryFn: () => getPublicUrl(entry.media_id),
        enabled: !rendition,
        staleTime: 30 * 60 * 1000,
    });
    const imageUrl = rendition ?? original.data;
    const [alt, setAlt] = useState<Record<string, string>>(entry.alt_i18n);
    useEffect(() => setAlt(entry.alt_i18n), [entry.alt_i18n]);
    const altChanged = PRODUCT_LOCALES.some(
        (locale) => (alt[locale] ?? '') !== (entry.alt_i18n[locale] ?? '')
    );
    const tag = entry.tag ?? '';
    // The institute's own tags (with the one the shop shows first), from the server.
    const tagList = useMediaTags().data;
    const tagOptions = offeredMediaTags(tagList, tag).map((value) => ({
        value,
        label:
            value === tagList?.lead_tag
                ? `${mediaTagLabel(t, value)} (${t('products.media.leadTag')})`
                : mediaTagLabel(t, value),
    }));

    return (
        <li className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex gap-3">
                <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {imageUrl ? (
                        <img
                            src={imageUrl}
                            alt={alt.hi || alt.en || ''}
                            className="size-full object-cover"
                            loading="lazy"
                        />
                    ) : (
                        <ImageIcon size={24} className="text-muted-foreground" />
                    )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        {isCover && (
                            <span className="rounded-md bg-primary-50 px-2 py-0.5 text-caption text-primary-500">
                                {t('products.media.cover')}
                            </span>
                        )}
                        <CommerceStatusChip kind="mediaRendition" value={status} />
                    </div>
                    {status === 'FAILED' && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-caption text-danger-600">
                                {failure ?? t('products.media.renditionFailed')}
                            </span>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                type="button"
                                onAsyncClick={onRetry}
                                loadingText={t('products.media.retrying')}
                            >
                                {t('products.media.retry')}
                            </MyButton>
                        </div>
                    )}
                    {entry.width && entry.height && (
                        <span className="text-caption tabular-nums text-muted-foreground">
                            {t('products.media.size', { width: entry.width, height: entry.height })}
                        </span>
                    )}
                    <div className="flex items-center gap-1">
                        <MyButton
                            buttonType="secondary"
                            layoutVariant="icon"
                            scale="small"
                            type="button"
                            disable={!canMoveBack || busy}
                            aria-label={t('products.media.moveEarlier')}
                            onClick={() => onMove(-1)}
                        >
                            <ArrowLeft size={14} className="rtl:rotate-180" />
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            layoutVariant="icon"
                            scale="small"
                            type="button"
                            disable={!canMoveForward || busy}
                            aria-label={t('products.media.moveLater')}
                            onClick={() => onMove(1)}
                        >
                            <ArrowRight size={14} className="rtl:rotate-180" />
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            layoutVariant="icon"
                            scale="small"
                            type="button"
                            aria-label={t('products.media.remove')}
                            onClick={onRemove}
                        >
                            <Trash size={14} />
                        </MyButton>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <PlainSelect
                    label={t('products.media.tag')}
                    value={tag}
                    onChange={(next) => void onSave({ tag: next })}
                    noneLabel={t('products.media.tags.none')}
                    options={tagOptions}
                />
                <PlainSelect
                    label={t('products.media.variant')}
                    value={entry.package_session_id ?? ''}
                    onChange={(next) => void onSave({ package_session_id: next })}
                    noneLabel={t('products.media.allVariants')}
                    options={variantOptions}
                />
                {PRODUCT_LOCALES.map((locale) => (
                    <div key={locale} className="flex min-w-0 flex-col gap-1.5">
                        <label
                            htmlFor={`alt-${entry.id}-${locale}`}
                            className="text-caption text-muted-foreground"
                        >
                            {t('products.media.alt', {
                                language: t(`products.languages.${locale}`),
                            })}
                        </label>
                        <MyInput
                            id={`alt-${entry.id}-${locale}`}
                            inputType="text"
                            lang={locale}
                            maxLength={200}
                            input={alt[locale] ?? ''}
                            onChangeFunction={(event) =>
                                setAlt((current) => ({ ...current, [locale]: event.target.value }))
                            }
                            className="sm:w-full"
                        />
                    </div>
                ))}
            </div>
            {altChanged && (
                <div className="flex justify-end">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        onAsyncClick={() => onSave({ alt_i18n: alt })}
                        loadingText={t('common.saving')}
                    >
                        {t('products.media.saveAlt')}
                    </MyButton>
                </div>
            )}
        </li>
    );
}
