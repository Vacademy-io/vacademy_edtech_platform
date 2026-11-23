/**
 * Photos / video for a post. Files upload straight to S3 through UploadFileInS3 and the
 * composer keeps only their file ids; a local object URL gives an instant preview.
 */
import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CircleNotch,
    ImageSquare,
    UploadSimple,
    VideoCamera,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { UploadFileInS3 } from '@/services/upload_file';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getUserId } from '@/utils/userDetails';
import { cn } from '@/lib/utils';
import { MAX_IMAGE_BYTES, MAX_MEDIA, MAX_VIDEO_BYTES, type ComposerMedia } from './social-utils';

const noop = () => undefined;
let localSeq = 0;

export function MediaPicker({
    media,
    onChange,
}: {
    media: ComposerMedia[];
    /** Functional update so concurrent uploads never overwrite each other. */
    onChange: (update: (current: ComposerMedia[]) => ComposerMedia[]) => void;
}) {
    const { t } = useTranslation('marketingSocial');
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const upload = async (item: ComposerMedia, file: File) => {
        try {
            const fileId = await UploadFileInS3(
                file,
                noop,
                getUserId(),
                'INSTITUTE',
                getCurrentInstituteId() ?? undefined,
                true
            );
            if (!fileId) throw new Error('no file id');
            onChange((current) =>
                current.map((m) =>
                    m.key === item.key ? { ...m, file_id: fileId, uploading: false } : m
                )
            );
        } catch {
            toast.error(t('composer.media.uploadFailed', { name: file.name }));
            onChange((current) =>
                current.map((m) =>
                    m.key === item.key ? { ...m, uploading: false, failed: true } : m
                )
            );
        }
    };

    const addFiles = (files: FileList | File[]) => {
        const list = Array.from(files);
        const room = MAX_MEDIA - media.length;
        if (room <= 0) {
            toast.error(t('composer.issues.tooManyMedia', { max: MAX_MEDIA }));
            return;
        }
        if (list.length > room) toast.info(t('composer.media.onlyFirst', { count: room }));
        const accepted: { item: ComposerMedia; file: File }[] = [];
        for (const file of list.slice(0, room)) {
            const isImage = file.type.startsWith('image/');
            const isVideo = file.type.startsWith('video/');
            if (!isImage && !isVideo) {
                toast.error(t('composer.media.unsupported', { name: file.name }));
                continue;
            }
            if (isImage && file.size > MAX_IMAGE_BYTES) {
                toast.error(t('composer.media.imageTooBig', { name: file.name, mb: 8 }));
                continue;
            }
            if (isVideo && file.size > MAX_VIDEO_BYTES) {
                toast.error(t('composer.media.videoTooBig', { name: file.name, gb: 1 }));
                continue;
            }
            localSeq += 1;
            accepted.push({
                file,
                item: {
                    key: `local-${Date.now()}-${localSeq}`,
                    file_id: null,
                    type: isVideo ? 'VIDEO' : 'IMAGE',
                    name: file.name,
                    previewUrl: URL.createObjectURL(file),
                    localPreview: true,
                    uploading: true,
                    failed: false,
                },
            });
        }
        if (accepted.length === 0) return;
        onChange((current) => [...current, ...accepted.map((a) => a.item)]);
        accepted.forEach(({ item, file }) => void upload(item, file));
    };

    const remove = (item: ComposerMedia) => {
        if (item.localPreview && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        onChange((current) => current.filter((m) => m.key !== item.key));
    };

    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
    };

    return (
        <div className="flex flex-col gap-2">
            <div
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                    'flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 transition-colors',
                    dragging
                        ? 'border-primary-400 bg-primary-50'
                        : 'border-neutral-300 bg-neutral-50'
                )}
            >
                {media.map((item) => (
                    <div
                        key={item.key}
                        className={cn(
                            'relative flex size-20 items-center justify-center overflow-hidden rounded-md border bg-white',
                            item.failed ? 'border-danger-300' : 'border-neutral-200'
                        )}
                    >
                        {item.previewUrl && item.type === 'IMAGE' && (
                            <img
                                src={item.previewUrl}
                                alt={item.name}
                                className="size-full object-cover"
                            />
                        )}
                        {item.previewUrl && item.type === 'VIDEO' && (
                            <video
                                src={item.previewUrl}
                                className="size-full object-cover"
                                preload="metadata"
                                muted
                                aria-label={item.name}
                            />
                        )}
                        {!item.previewUrl &&
                            (item.type === 'VIDEO' ? (
                                <VideoCamera size={22} className="text-neutral-400" aria-hidden />
                            ) : (
                                <ImageSquare size={22} className="text-neutral-400" aria-hidden />
                            ))}
                        {item.type === 'VIDEO' && item.previewUrl && (
                            <span className="absolute bottom-1 start-1 rounded bg-neutral-900/70 p-0.5 text-white">
                                <VideoCamera size={12} aria-hidden />
                            </span>
                        )}
                        {item.uploading && (
                            <span
                                className="absolute inset-0 flex items-center justify-center bg-white/70"
                                role="status"
                                aria-label={t('composer.media.uploading', { name: item.name })}
                            >
                                <CircleNotch size={20} className="animate-spin text-primary-500" />
                            </span>
                        )}
                        {item.failed && (
                            <span className="absolute inset-0 flex items-center justify-center bg-danger-50/80">
                                <WarningCircle size={20} className="text-danger-600" aria-hidden />
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => remove(item)}
                            className="absolute end-1 top-1 flex size-5 items-center justify-center rounded-full bg-neutral-900/70 text-white hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                            aria-label={t('composer.media.remove', { name: item.name })}
                        >
                            <X size={12} weight="bold" />
                        </button>
                    </div>
                ))}
                {media.length < MAX_MEDIA && (
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-neutral-300 bg-white text-neutral-500 hover:border-primary-300 hover:text-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                    >
                        <UploadSimple size={18} aria-hidden />
                        <span className="text-caption">{t('composer.media.add')}</span>
                    </button>
                )}
                {media.length === 0 && (
                    <p className="text-caption text-neutral-500">{t('composer.media.hint')}</p>
                )}
            </div>
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                multiple
                className="hidden"
                onChange={(event) => {
                    if (event.target.files?.length) addFiles(event.target.files);
                    event.target.value = '';
                }}
            />
        </div>
    );
}
