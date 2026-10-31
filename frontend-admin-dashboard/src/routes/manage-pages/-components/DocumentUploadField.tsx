import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    UploadSimple as Upload,
    CircleNotch as Loader2,
    FilePdf,
    ArrowSquareOut,
} from '@phosphor-icons/react';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';

interface DocumentUploadFieldProps {
    label: string;
    value: string;
    onChange: (url: string) => void;
    placeholder?: string;
}

const MAX_PDF_MB = 25;

const fileNameOf = (url: string) => {
    try {
        return decodeURIComponent(url.split('?')[0]?.split('/').pop() || '') || url;
    } catch {
        return url;
    }
};

/**
 * PDF counterpart to VideoUploadField: paste a hosted PDF link OR upload one.
 * Upload goes through the same media-service path as images, into the PUBLIC
 * bucket, and stores the resolved CDN URL — the learner viewer fetches it with
 * pdf.js, so the file must be publicly readable, not a signed private URL.
 *
 * S3 keeps whatever Content-Type the PUT sends, and the browser only sends
 * `application/pdf` for a real PDF, so the accept filter doubles as the
 * guarantee that the stored object opens inline instead of downloading.
 */
export const DocumentUploadField = ({
    label,
    value,
    onChange,
    placeholder,
}: DocumentUploadFieldProps) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { uploadFile } = useFileUpload();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setError(null);

        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (!isPdf) {
            setError(t('documentViewer.onlyPdf'));
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }
        if (file.size > MAX_PDF_MB * 1024 * 1024) {
            setError(t('documentViewer.tooLarge', { max: MAX_PDF_MB }));
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        const userId = getUserId();
        if (!userId) {
            console.error('[DocumentUploadField] No userId found');
            return;
        }

        try {
            setIsUploading(true);
            const fileId = await uploadFile({
                file,
                setIsUploading,
                userId,
                source: 'CATALOGUE_DOCUMENTS',
                sourceId: 'ADMIN',
                publicUrl: true,
            });
            if (fileId) {
                const resolvedUrl = await getPublicUrl(fileId);
                onChange(resolvedUrl || fileId);
            }
        } catch (err) {
            console.error('[DocumentUploadField] Upload failed:', err);
            setError(t('documentViewer.uploadFailed'));
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="space-y-2">
            <Label>{label}</Label>

            {value ? (
                <div className="flex items-center gap-2 rounded border bg-gray-50 px-3 py-2 text-xs text-gray-700">
                    <FilePdf className="size-5 shrink-0 text-red-500" />
                    <span className="min-w-0 flex-1 truncate font-medium" title={value}>
                        {fileNameOf(value)}
                    </span>
                    <a
                        href={value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-primary-500 hover:underline"
                    >
                        <ArrowSquareOut className="size-3.5" />
                        {t('documentViewer.openFile')}
                    </a>
                </div>
            ) : (
                <div className="flex h-16 w-full items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-gray-400">
                    <FilePdf className="size-5" />
                </div>
            )}

            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || 'https://.../catalogue.pdf'}
                className="text-sm"
            />

            <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={handleFileChange}
            />
            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                >
                    {isUploading ? (
                        <>
                            <Loader2 className="me-2 size-4 animate-spin" />
                            {t('documentViewer.uploading')}
                        </>
                    ) : (
                        <>
                            <Upload className="me-2 size-4" />
                            {t('documentViewer.uploadPdf')}
                        </>
                    )}
                </Button>
                {value && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onChange('')}
                        disabled={isUploading}
                    >
                        {t('documentViewer.clear')}
                    </Button>
                )}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
    );
};
