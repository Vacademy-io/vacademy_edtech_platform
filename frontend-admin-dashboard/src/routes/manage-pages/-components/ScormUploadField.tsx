import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    UploadSimple as Upload,
    CircleNotch as Loader2,
    BookOpenText,
    ArrowSquareOut,
} from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { SCORM_UPLOAD } from '@/constants/urls';

interface ScormUploadFieldProps {
    label: string;
    value: string;
    onChange: (launchUrl: string) => void;
}

const MAX_ZIP_MB = 200;

/**
 * SCORM counterpart to DocumentUploadField. The zip goes through the same
 * admin-core upload a course SCORM slide uses (scorm/v1/upload), which unpacks
 * it onto the public media bucket next to our player wrapper; the section
 * stores that wrapper's launch_url and the learner site plays it in a frame.
 */
export const ScormUploadField = ({ label, value, onChange }: ScormUploadFieldProps) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const resetInput = () => {
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setError(null);

        if (!/\.zip$/i.test(file.name)) {
            setError(t('scormViewer.onlyZip'));
            resetInput();
            return;
        }
        if (file.size > MAX_ZIP_MB * 1024 * 1024) {
            setError(t('scormViewer.tooLarge', { max: MAX_ZIP_MB }));
            resetInput();
            return;
        }

        try {
            setIsUploading(true);
            const formData = new FormData();
            formData.append('file', file);
            const response = await authenticatedAxiosInstance.post(SCORM_UPLOAD, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const launchUrl: string | undefined = response.data?.launch_url;
            if (!launchUrl) throw new Error('no launch_url');
            onChange(launchUrl);
        } catch (err) {
            console.error('[ScormUploadField] Upload failed:', err);
            setError(t('scormViewer.uploadFailed'));
        } finally {
            setIsUploading(false);
            resetInput();
        }
    };

    return (
        <div className="space-y-2">
            <Label>{label}</Label>

            {value ? (
                <div className="flex items-center gap-2 rounded border bg-gray-50 px-3 py-2 text-xs text-gray-700">
                    <BookOpenText className="size-5 shrink-0 text-primary-500" />
                    <span className="min-w-0 flex-1 truncate font-medium" title={value}>
                        {t('scormViewer.packageReady')}
                    </span>
                    <a
                        href={value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-primary-500 hover:underline"
                    >
                        <ArrowSquareOut className="size-3.5" />
                        {t('scormViewer.openPackage')}
                    </a>
                </div>
            ) : (
                <div className="flex h-16 w-full items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-gray-400">
                    <BookOpenText className="size-5" />
                </div>
            )}

            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="https://.../vacademy_player_v2.html"
                className="text-sm"
            />

            <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
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
                            {t('scormViewer.uploading')}
                        </>
                    ) : (
                        <>
                            <Upload className="me-2 size-4" />
                            {t('scormViewer.uploadZip')}
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
                        {t('scormViewer.clear')}
                    </Button>
                )}
            </div>
            <p className="text-xs text-gray-500">{t('scormViewer.uploadHelp')}</p>
            {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
    );
};
