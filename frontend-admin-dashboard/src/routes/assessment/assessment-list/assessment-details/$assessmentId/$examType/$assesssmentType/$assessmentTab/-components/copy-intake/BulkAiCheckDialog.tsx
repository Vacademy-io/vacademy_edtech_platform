import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Coins, FilePdf, Trash, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { countPdfPages } from '@/services/pdf-page-count';
import { cn } from '@/lib/utils';
import {
    getCopyCheckConfig,
    startCopyIntake,
    type CopyIntakeBatch,
} from '../../-services/copy-intake-services';
import {
    CommentPlacementPicker,
    useInstituteCommentPlacement,
} from '@/components/common/ai-copy-check/CommentPlacementPicker';
import {
    CopyCheckSettingsFields,
    toCopyCheckConfig,
    useCopyCheckSettings,
} from '@/components/common/ai-copy-check/CopyCheckSettingsFields';
import { CopyCheckCriteriaPanel } from '@/components/common/ai-copy-check/CopyCheckCriteriaPanel';

interface PendingFile {
    key: string;
    file: File;
    pages: number | null;
    state: 'counting' | 'ready' | 'uploading' | 'uploaded' | 'error';
    fileId?: string;
    error?: string;
}

const MAX_FILES = 200;
const MAX_MB = 60;

/**
 * Upload a pile of scanned copies at once. Each file is page-counted (shown in
 * the quote; the check itself is billed per graded question, so the quote is
 * copies x questions), uploaded to storage, then the batch is started: the
 * server reads the student's name off every copy, matches it to the
 * assessment's students and queues the AI check. Progress lives in the batch
 * panel; the admin is told by email, bell and toast when it settles.
 */
export const BulkAiCheckDialog = ({
    open,
    onOpenChange,
    assessmentId,
    instituteId,
    questionsPerCopy,
    onStarted,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assessmentId: string;
    instituteId: string;
    /** Questions on the paper — the unit the AI check is billed in. */
    questionsPerCopy: number;
    onStarted: (batch: CopyIntakeBatch) => void;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const inputRef = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<PendingFile[]>([]);
    const [notifyEmail, setNotifyEmail] = useState(true);
    // Preselected from the institute's default (Settings → Assessment); the teacher can change it per batch.
    const [commentPlacement, setCommentPlacement] = useInstituteCommentPlacement(open);
    // Subject, marking instructions and language feedback: the assessment's own, else the institute's.
    const [copyCheckSettings, setCopyCheckSettings] = useCopyCheckSettings(open, () =>
        getCopyCheckConfig(assessmentId, instituteId)
    );
    const [, setIsUploading] = useState(false);
    const { uploadFile } = useFileUpload();
    const userId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';

    const counting = files.some((f) => f.state === 'counting');
    // Mirrors the charge the orchestrator records per completed copy
    // (num_questions = graded questions), once per copy: the rate card's flat
    // base and rounding apply to each copy, so the inputs are NOT summed
    // across files. The rate itself comes from ai_tool_pricing via the API.
    const cost = useToolCostPreview(
        'copy_check_evaluation',
        { num_questions: questionsPerCopy },
        files.length > 0 && !counting,
        files.length
    );
    // "1 + 0.2 per question" under the quote, straight from the rate row so a
    // DB change to the price is explained without a release.
    const rateLine = useMemo(() => {
        const row = cost.rate;
        if (!row) return null;
        const flat = Number(row.flat_base_credits) || 0;
        const perUnit = Number(row.per_unit_credits) || 0;
        const unit =
            row.unit_field === 'questions'
                ? t('dialog.unitQuestion')
                : row.unit_field === 'pages'
                  ? t('dialog.unitPage')
                  : null;
        if (!unit) return null;
        return t(flat > 0 ? 'dialog.rate' : 'dialog.rateNoBase', { flat, perUnit, unit });
    }, [cost.rate, t]);

    const addFiles = async (picked: FileList | File[]) => {
        // PDF only: the grading pipeline opens the copy as a PDF, so an image
        // would upload fine and then fail at the check.
        const incoming = Array.from(picked).filter((f) => {
            const ok = /\.pdf$/i.test(f.name);
            if (!ok) toast.error(t('errors.notPdf', { name: f.name }));
            else if (f.size > MAX_MB * 1024 * 1024)
                toast.error(t('errors.tooLarge', { name: f.name, mb: MAX_MB }));
            return ok && f.size <= MAX_MB * 1024 * 1024;
        });
        if (files.length + incoming.length > MAX_FILES) {
            toast.error(t('errors.tooMany', { max: MAX_FILES }));
            return;
        }
        const existing = new Set(files.map((f) => `${f.file.name}:${f.file.size}`));
        const fresh = incoming
            .filter((f) => !existing.has(`${f.name}:${f.size}`))
            .map<PendingFile>((file) => ({
                key: `${file.name}:${file.size}:${file.lastModified}`,
                file,
                pages: null,
                state: 'counting',
            }));
        setFiles((prev) => [...prev, ...fresh]);
        // Count pages off the local file: the quote must be right before any credit is spent.
        await Promise.all(
            fresh.map(async (pf) => {
                let pages = 1;
                try {
                    const url = URL.createObjectURL(pf.file);
                    pages = await countPdfPages(url);
                    URL.revokeObjectURL(url);
                } catch {
                    pages = 1;
                }
                setFiles((prev) =>
                    prev.map((x) => (x.key === pf.key ? { ...x, pages, state: 'ready' } : x))
                );
            })
        );
    };

    const remove = (key: string) => setFiles((prev) => prev.filter((f) => f.key !== key));

    const start = useMutation({
        mutationFn: async () => {
            // Upload sequentially in pairs so 200 files do not open 200 sockets.
            const uploaded: { file_id: string; file_name: string; page_count?: number }[] = [];
            const queue = [...files];
            const worker = async () => {
                while (queue.length) {
                    const pf = queue.shift();
                    if (!pf) return;
                    if (pf.fileId) {
                        uploaded.push({
                            file_id: pf.fileId,
                            file_name: pf.file.name,
                            page_count: pf.pages ?? undefined,
                        });
                        continue;
                    }
                    setFiles((prev) =>
                        prev.map((x) => (x.key === pf.key ? { ...x, state: 'uploading' } : x))
                    );
                    try {
                        const fileId = await uploadFile({
                            file: pf.file,
                            setIsUploading,
                            userId,
                            source: instituteId,
                            sourceId: 'ASSESSMENT_OFFLINE_ENTRY',
                        });
                        if (!fileId) throw new Error('no file id');
                        uploaded.push({
                            file_id: fileId,
                            file_name: pf.file.name,
                            page_count: pf.pages ?? undefined,
                        });
                        setFiles((prev) =>
                            prev.map((x) =>
                                x.key === pf.key ? { ...x, state: 'uploaded', fileId } : x
                            )
                        );
                    } catch (e) {
                        setFiles((prev) =>
                            prev.map((x) =>
                                x.key === pf.key
                                    ? {
                                          ...x,
                                          state: 'error',
                                          error: e instanceof Error ? e.message : 'upload failed',
                                      }
                                    : x
                            )
                        );
                    }
                }
            };
            await Promise.all([worker(), worker()]);
            if (uploaded.length === 0) throw new Error(t('errors.nothingUploaded'));
            // No preferred model: the platform's evaluation default applies.
            return startCopyIntake(
                assessmentId,
                instituteId,
                uploaded,
                undefined,
                notifyEmail,
                commentPlacement,
                toCopyCheckConfig(copyCheckSettings)
            );
        },
        onSuccess: (batch) => {
            toast.success(t('toasts.started', { count: batch.total_items }));
            setFiles([]);
            onOpenChange(false);
            onStarted(batch);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('errors.startFailed')),
    });

    const failedUploads = files.filter((f) => f.state === 'error').length;
    const canStart = files.length > 0 && !counting && !start.isPending && cost.sufficient !== false;

    return (
        <MyDialog
            heading={t('dialog.title')}
            open={open}
            onOpenChange={(next) => {
                if (start.isPending) return;
                onOpenChange(next);
            }}
            dialogWidth="max-w-3xl"
        >
            <div className="flex flex-col gap-4 p-4 sm:p-6">
                <p className="text-sm text-neutral-600">{t('dialog.intro')}</p>

                <button
                    type="button"
                    className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center transition-colors hover:border-primary-400 hover:bg-primary-50"
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        void addFiles(e.dataTransfer.files);
                    }}
                >
                    <UploadSimple size={28} className="text-primary-500" />
                    <span className="text-sm font-medium text-neutral-700">{t('dialog.drop')}</span>
                    <span className="text-caption text-neutral-500">
                        {t('dialog.dropHint', { max: MAX_FILES, mb: MAX_MB })}
                    </span>
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.files) void addFiles(e.target.files);
                            e.target.value = '';
                        }}
                    />
                </button>

                {files.length > 0 && (
                    <ul className="max-h-list-md divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
                        {files.map((f) => (
                            <li key={f.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                                <FilePdf size={18} className="shrink-0 text-danger-500" />
                                <span className="min-w-0 flex-1 truncate text-neutral-800">
                                    {f.file.name}
                                </span>
                                <span className="shrink-0 text-caption text-neutral-500">
                                    {f.state === 'counting'
                                        ? t('dialog.counting')
                                        : f.state === 'uploading'
                                          ? t('dialog.uploading')
                                          : f.state === 'error'
                                            ? t('dialog.uploadFailed')
                                            : t('dialog.pages', { count: f.pages ?? 1 })}
                                </span>
                                {!start.isPending && (
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        layoutVariant="icon"
                                        aria-label={t('dialog.remove')}
                                        onClick={() => remove(f.key)}
                                    >
                                        <Trash size={16} />
                                    </MyButton>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                <div
                    className={cn(
                        'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm',
                        cost.sufficient === false
                            ? 'border-danger-200 bg-danger-50 text-danger-700'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                    )}
                >
                    <span className="flex items-center gap-2">
                        <Coins size={16} className="text-primary-500" />
                        {files.length === 0
                            ? t('dialog.costEmpty')
                            : counting || cost.credits == null
                              ? t('dialog.counting')
                              : t('dialog.cost', {
                                    count: files.length,
                                    questions: questionsPerCopy,
                                    credits: cost.credits,
                                })}
                    </span>
                    {cost.currentBalance != null && (
                        <span className="text-caption text-neutral-500">
                            {t('dialog.balance', { count: cost.currentBalance })}
                        </span>
                    )}
                    {rateLine && files.length > 0 && !counting && (
                        <span className="basis-full text-caption text-neutral-500">{rateLine}</span>
                    )}
                </div>
                {cost.sufficient === false && (
                    <p className="flex items-start gap-2 text-caption text-danger-600">
                        <WarningCircle size={16} className="mt-px shrink-0" />
                        {t('dialog.insufficient')}
                    </p>
                )}

                <CommentPlacementPicker
                    value={commentPlacement}
                    onChange={setCommentPlacement}
                    disabled={start.isPending}
                />

                <CopyCheckSettingsFields
                    value={copyCheckSettings}
                    onChange={setCopyCheckSettings}
                    disabled={start.isPending}
                />

                <CopyCheckCriteriaPanel
                    assessmentId={assessmentId}
                    subject={copyCheckSettings.subject}
                    disabled={start.isPending}
                />

                <label className="flex items-center gap-2 text-sm text-neutral-700">
                    <input
                        type="checkbox"
                        checked={notifyEmail}
                        onChange={(e) => setNotifyEmail(e.target.checked)}
                        className="size-4 accent-primary-500"
                    />
                    {t('dialog.notifyEmail')}
                </label>

                {failedUploads > 0 && (
                    <p className="text-caption text-danger-600">
                        {t('dialog.someFailed', { count: failedUploads })}
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
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={!canStart}
                        onClick={() => start.mutate()}
                    >
                        {start.isPending
                            ? t('dialog.starting')
                            : t('dialog.start', { count: files.length })}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};

export default BulkAiCheckDialog;
