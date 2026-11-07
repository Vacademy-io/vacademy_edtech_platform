import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDropzone, FileRejection, DropEvent } from 'react-dropzone';
import { UploadSimple, File, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface FileUploaderProps {
    onFileSelected: (file: File) => void;
    onUploadComplete?: (audioUrl: string) => void;
    maxSize?: number; // in MB
    acceptFormats?: Record<string, string[]>;
    acceptMsg?: string;
}

const ACCEPTED_FORMATS = {
    'audio/mpeg': ['.mp3'],
    'audio/wav': ['.wav'],
    'audio/mp4': ['.m4a'],
    'audio/ogg': ['.ogg'],
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export function FileUploader({
    onFileSelected,
    onUploadComplete,
    maxSize = 100,
    acceptFormats = {
        'audio/mpeg': ['.mp3'],
        'audio/wav': ['.wav'],
        'audio/mp4': ['.m4a'],
        'audio/ogg': ['.ogg'],
    },
    acceptMsg,
}: FileUploaderProps) {
    const { t } = useTranslation('instructorCopilotFileUploader');
    const resolvedAcceptMsg = acceptMsg ?? t('defaultAcceptMsg');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const onDrop = useCallback(
        <T extends File>(acceptedFiles: T[], fileRejections: FileRejection[], event: DropEvent) => {
            setError(null);

            if (fileRejections.length > 0) {
                const rejection = fileRejections[0];
                if (rejection?.errors[0]?.code === 'file-too-large') {
                    setError(t('errors.fileTooLarge', { maxSize }));
                } else if (rejection?.errors[0]?.code === 'file-invalid-type') {
                    setError(t('errors.invalidFileType', { formats: resolvedAcceptMsg }));
                } else {
                    setError(t('errors.uploadFailed'));
                }
                return;
            }

            if (acceptedFiles.length > 0) {
                const file = acceptedFiles[0];
                if (file) {
                    setSelectedFile(file);
                    onFileSelected(file);
                }
            }
        },
        [maxSize, onFileSelected, resolvedAcceptMsg, t]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: acceptFormats,
        maxSize: maxSize * 1024 * 1024,
        multiple: false,
    });

    const handleRemoveFile = () => {
        setSelectedFile(null);
        setUploadProgress(0);
        setError(null);
    };

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return `0 ${t('units.bytes')}`;
        const k = 1024;
        const sizes = [t('units.bytes'), t('units.kb'), t('units.mb'), t('units.gb')];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    return (
        <div className="w-full space-y-4">
            {!selectedFile ? (
                <div
                    {...getRootProps()}
                    className={cn(
                        'cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors sm:p-8',
                        isDragActive
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
                    )}
                >
                    <input {...getInputProps()} />
                    <UploadSimple size={48} className="mx-auto mb-4 text-gray-400" />
                    <p className="mb-2 text-lg font-medium text-gray-700">
                        {isDragActive ? t('dropHere') : t('dragDrop')}
                    </p>
                    <p className="mb-4 text-sm text-gray-500">{t('clickToBrowse')}</p>
                    <p className="text-xs text-gray-400">
                        {t('formatsAndMaxSize', { formats: resolvedAcceptMsg, maxSize })}
                    </p>
                </div>
            ) : (
                <div className="rounded-lg border border-gray-200 p-4">
                    <div className="mb-3 flex items-start justify-between">
                        <div className="flex flex-1 items-center gap-3">
                            <div className="rounded bg-primary-100 p-2">
                                <File size={24} className="text-primary-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-gray-900">
                                    {selectedFile.name}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {formatFileSize(selectedFile.size)}
                                </p>
                            </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleRemoveFile}>
                            <X size={18} />
                        </Button>
                    </div>

                    {uploadProgress > 0 && (
                        <div className="space-y-2">
                            <Progress value={uploadProgress} className="h-2" />
                            <p className="text-center text-xs text-gray-500">
                                {t('uploading', { percent: uploadProgress })}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-sm text-red-600">{error}</p>
                </div>
            )}
        </div>
    );
}
