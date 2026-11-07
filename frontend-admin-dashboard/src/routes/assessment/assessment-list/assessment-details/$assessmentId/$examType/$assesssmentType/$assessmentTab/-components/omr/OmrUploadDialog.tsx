import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileImage, FilePdf, Trash, UploadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import {
    OMR_MAX_FILES,
    omrErrorMessage,
    startOmrScan,
    type OmrBatch,
    type OmrSet,
    type OmrUploadedFile,
} from '../../-services/omr-services';

interface PendingFile {
    key: string;
    file: File;
    state: 'ready' | 'uploading' | 'uploaded' | 'error';
    fileId?: string;
}

const MAX_MB = 60;
const ACCEPTED = /\.(pdf|jpe?g|png)$/i;

/**
 * Hand the filled sheets of one set back: one class PDF (a page per sheet)
 * and/or a pile of PDF / JPG / PNG files. Each file goes to storage with
 * source = the institute (the server refuses files not recorded for it), then
 * the scan starts; reading, matching and grading happen in the background.
 */
export const OmrUploadDialog = ({
    assessmentId,
    instituteId,
    set,
    onOpenChange,
    onStarted,
}: {
    assessmentId: string;
    instituteId: string;
    set: OmrSet;
    onOpenChange: (open: boolean) => void;
    onStarted: (batch: OmrBatch) => void;
}) => {
    const { t } = useTranslation('assessmentOmr');
    const inputRef = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<PendingFile[]>([]);
    const [, setIsUploading] = useState(false);
    const { uploadFile } = useFileUpload();
    const userId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';

    const addFiles = (picked: FileList | File[]) => {
        const incoming = Array.from(picked).filter((f) => {
            if (!ACCEPTED.test(f.name)) {
                toast.error(t('upload.notAccepted', { name: f.name }));
                return false;
            }
            if (f.size > MAX_MB * 1024 * 1024) {
                toast.error(t('upload.tooLarge', { name: f.name, mb: MAX_MB }));
                return false;
            }
            return true;
        });
        const existing = new Set(files.map((f) => `${f.file.name}:${f.file.size}`));
        const fresh = incoming
            .filter((f) => !existing.has(`${f.name}:${f.size}`))
            .map<PendingFile>((file) => ({
                key: `${file.name}:${file.size}:${file.lastModified}`,
                file,
                state: 'ready',
            }));
        if (files.length + fresh.length > OMR_MAX_FILES) {
            toast.error(t('upload.tooMany', { max: OMR_MAX_FILES }));
            return;
        }
        setFiles((prev) => [...prev, ...fresh]);
    };

    const remove = (key: string) => setFiles((prev) => prev.filter((f) => f.key !== key));

    const mark = (key: string, patch: Partial<PendingFile>) =>
        setFiles((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));

    const start = useMutation({
        mutationFn: async () => {
            const uploaded: OmrUploadedFile[] = [];
            const queue = [...files];
            // Two at a time, as copy intake does, so 300 files do not open 300 sockets.
            const worker = async () => {
                while (queue.length) {
                    const pf = queue.shift();
                    if (!pf) return;
                    if (pf.fileId) {
                        uploaded.push({ file_id: pf.fileId, file_name: pf.file.name });
                        continue;
                    }
                    mark(pf.key, { state: 'uploading' });
                    try {
                        const fileId = await uploadFile({
                            file: pf.file,
                            setIsUploading,
                            userId,
                            source: instituteId,
                            sourceId: 'ASSESSMENT_OFFLINE_ENTRY',
                        });
                        if (!fileId) throw new Error('no file id');
                        uploaded.push({ file_id: fileId, file_name: pf.file.name });
                        mark(pf.key, { state: 'uploaded', fileId });
                    } catch {
                        mark(pf.key, { state: 'error' });
                    }
                }
            };
            await Promise.all([worker(), worker()]);
            if (uploaded.length === 0) throw new Error(t('upload.nothingUploaded'));
            return startOmrScan(assessmentId, instituteId, set.id, uploaded);
        },
        onSuccess: (batch) => {
            toast.success(t('upload.started', { count: batch.total_files }));
            setFiles([]);
            onStarted(batch);
        },
        onError: (e) => toast.error(omrErrorMessage(e, t('errors.startFailed'))),
    });

    const failed = files.filter((f) => f.state === 'error').length;

    return (
        <MyDialog
            heading={t('upload.title', { code: set.set_code })}
            open
            onOpenChange={(next) => {
                if (start.isPending) return;
                onOpenChange(next);
            }}
            dialogWidth="max-w-2xl"
        >
            <div className="flex flex-col gap-4 p-4 sm:p-6">
                <p className="text-sm text-neutral-600">
                    {t('upload.intro', { code: set.set_code })}
                </p>

                <button
                    type="button"
                    className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center transition-colors hover:border-primary-400 hover:bg-primary-50"
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        addFiles(e.dataTransfer.files);
                    }}
                    disabled={start.isPending}
                >
                    <UploadSimple size={28} className="text-primary-500" />
                    <span className="text-sm font-medium text-neutral-700">{t('upload.drop')}</span>
                    <span className="text-caption text-neutral-500">
                        {t('upload.dropHint', { max: OMR_MAX_FILES, mb: MAX_MB })}
                    </span>
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        accept="application/pdf,image/jpeg,image/png"
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.files) addFiles(e.target.files);
                            e.target.value = '';
                        }}
                    />
                </button>

                {files.length > 0 && (
                    <ul className="max-h-list-md divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
                        {files.map((f) => (
                            <li key={f.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                                {/\.pdf$/i.test(f.file.name) ? (
                                    <FilePdf size={18} className="shrink-0 text-danger-500" />
                                ) : (
                                    <FileImage size={18} className="shrink-0 text-primary-500" />
                                )}
                                <span className="min-w-0 flex-1 truncate text-neutral-800">
                                    {f.file.name}
                                </span>
                                <span className="shrink-0 text-caption text-neutral-500">
                                    {t(`upload.state.${f.state}`)}
                                </span>
                                {!start.isPending && (
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        layoutVariant="icon"
                                        aria-label={t('upload.remove')}
                                        onClick={() => remove(f.key)}
                                    >
                                        <Trash size={16} />
                                    </MyButton>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {failed > 0 && (
                    <p className="text-caption text-danger-600">
                        {t('upload.someFailed', { count: failed })}
                    </p>
                )}

                <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={start.isPending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={files.length === 0 || start.isPending}
                        onClick={() => start.mutate()}
                    >
                        {start.isPending
                            ? t('upload.starting')
                            : t('upload.start', { count: files.length })}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};

export default OmrUploadDialog;
