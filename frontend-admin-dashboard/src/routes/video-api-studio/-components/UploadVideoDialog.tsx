import { useState, useRef } from 'react';
import { UploadSimple, X, Video, Monitor } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import { createInputVideo, type InputVideoMode } from '../-services/input-video';
import { toast } from 'sonner';

const ACCEPTED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const MAX_SIZE_MB = 500;

interface UploadVideoDialogProps {
    apiKey: string;
    onClose: () => void;
    onComplete: () => void;
}

export function UploadVideoDialog({ apiKey, onClose, onComplete }: UploadVideoDialogProps) {
    const { t } = useTranslation('videoApiStudioUploadVideoDialog');
    const [name, setName] = useState('');
    const [mode, setMode] = useState<InputVideoMode>('podcast');
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { uploadFile, getPublicUrl } = useFileUpload();

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        if (!selected) return;
        e.target.value = '';

        if (!ACCEPTED_TYPES.includes(selected.type)) {
            toast.error(t('errors.unsupportedFormat'));
            return;
        }
        if (selected.size > MAX_SIZE_MB * 1024 * 1024) {
            toast.error(t('errors.fileTooLarge', { maxSize: MAX_SIZE_MB }));
            return;
        }

        setFile(selected);
        if (!name) {
            setName(selected.name.replace(/\.[^.]+$/, ''));
        }
    };

    const handleSubmit = async () => {
        if (!file || !name.trim()) return;

        try {
            // Step 1: Upload to S3
            setIsUploading(true);
            setUploadProgress(10);

            const fileId = await uploadFile({
                file,
                setIsUploading: () => {},
                userId: getUserId(),
                source: 'AI_INPUT_VIDEO',
                sourceId: 'ADMIN',
                publicUrl: true,
            });

            if (!fileId) throw new Error(t('errors.uploadFailed'));
            setUploadProgress(60);

            const sourceUrl = await getPublicUrl(fileId);
            if (!sourceUrl) throw new Error(t('errors.publicUrlFailed'));
            setUploadProgress(80);
            setIsUploading(false);

            // Step 2: Create record + start indexing
            setIsSubmitting(true);
            await createInputVideo(
                apiKey,
                {
                    name: name.trim(),
                    mode,
                    source_url: sourceUrl,
                },
                t
            );
            setUploadProgress(100);

            toast.success(t('success.uploadStarted'));
            onComplete();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('errors.uploadFailed'));
            setIsUploading(false);
            setIsSubmitting(false);
        }
    };

    const busy = isUploading || isSubmitting;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                {/* Header */}
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{t('title')}</h2>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <X className="size-5" />
                    </button>
                </div>

                {/* File picker */}
                <div className="mb-4">
                    {file ? (
                        <div className="flex items-center gap-2 rounded-md border bg-gray-50 px-3 py-2 text-sm">
                            <Video className="size-4 text-gray-500" />
                            <span className="flex-1 truncate">{file.name}</span>
                            <span className="text-gray-400">
                                {t('fileSize', { size: (file.size / 1024 / 1024).toFixed(1) })}
                            </span>
                            {!busy && (
                                <button
                                    onClick={() => setFile(null)}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    <X className="size-3.5" />
                                </button>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700"
                        >
                            <UploadSimple className="size-6" />
                            <span>{t('filePicker.selectPrompt')}</span>
                            <span className="text-xs text-gray-400">
                                {t('filePicker.sizeHint', { maxSize: MAX_SIZE_MB })}
                            </span>
                        </button>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPTED_TYPES.join(',')}
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                </div>

                {/* Name */}
                <div className="mb-4">
                    <label className="mb-1 block text-sm font-medium">{t('name.label')}</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('name.placeholder')}
                        className="w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        disabled={busy}
                    />
                </div>

                {/* Mode */}
                <div className="mb-6">
                    <label className="mb-2 block text-sm font-medium">{t('videoType.label')}</label>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setMode('podcast')}
                            disabled={busy}
                            className={`flex items-center gap-2 rounded-md border-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                                mode === 'podcast'
                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                        >
                            <Video className="size-4" />
                            {t('videoType.podcast')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('demo')}
                            disabled={busy}
                            className={`flex items-center gap-2 rounded-md border-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                                mode === 'demo'
                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                        >
                            <Monitor className="size-4" />
                            {t('videoType.demo')}
                        </button>
                    </div>
                </div>

                {/* Progress bar */}
                {busy && (
                    <div className="mb-4">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                            <div
                                className="h-full rounded-full bg-blue-500 transition-all"
                                style={{ width: `${uploadProgress}%` }}
                            />
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                            {isUploading ? t('progress.uploading') : t('progress.indexing')}
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
                    >
                        {t('actions.cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!file || !name.trim() || busy}
                        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                        {busy ? t('actions.processing') : t('actions.upload')}
                    </button>
                </div>
            </div>
        </div>
    );
}
