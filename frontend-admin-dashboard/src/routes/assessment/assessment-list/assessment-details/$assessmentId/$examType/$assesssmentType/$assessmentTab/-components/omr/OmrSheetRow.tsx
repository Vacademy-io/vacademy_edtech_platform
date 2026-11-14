import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleNotch, Eye, FilePdf, UserCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';
import {
    isOmrSheetActive,
    isOmrSheetFlagged,
    omrErrorMessage,
    retryOmrSheet,
    skipOmrSheet,
    type OmrSheet,
    type OmrSheetStatus,
} from '../../-services/omr-services';
import { OmrFileImage, openOmrFile } from './omr-file';
import { OmrAssignLearnerDialog } from './OmrAssignLearnerDialog';
import { OmrFixAnswersDialog } from './OmrFixAnswersDialog';

const SHEET_TONE: Record<OmrSheetStatus, StatusType> = {
    PENDING: 'INFO',
    READING: 'INFO',
    GRADED: 'SUCCESS',
    NEEDS_REVIEW: 'WARNING',
    FAILED: 'DANGER',
    SKIPPED: 'INFO',
};

/** One scanned page (or a file that would not open): what was read, who it went to, what to do. */
export const OmrSheetRow = ({
    sheet,
    assessmentId,
    instituteId,
    optionCountByNo,
    onChanged,
}: {
    sheet: OmrSheet;
    assessmentId: string;
    instituteId: string;
    optionCountByNo: Record<string, number>;
    onChanged: () => void;
}) => {
    const { t } = useTranslation('assessmentOmr');
    const [assignOpen, setAssignOpen] = useState(false);
    const [fixOpen, setFixOpen] = useState(false);
    const flagged = isOmrSheetFlagged(sheet);
    const flagCount = Object.keys(sheet.flags ?? {}).length;

    const skip = useMutation({
        mutationFn: () => skipOmrSheet(sheet.id, instituteId),
        onSuccess: () => {
            toast.success(t('toasts.skipped'));
            onChanged();
        },
        onError: (e) => toast.error(omrErrorMessage(e, t('errors.actionFailed'))),
    });
    const retry = useMutation({
        mutationFn: () => retryOmrSheet(sheet.id, instituteId),
        onSuccess: () => {
            toast.success(t('toasts.retried'));
            onChanged();
        },
        onError: (e) => toast.error(omrErrorMessage(e, t('errors.actionFailed'))),
    });
    const open = useMutation({
        mutationFn: (fileId: string) => openOmrFile(fileId),
        onSuccess: (ok) => {
            if (!ok) toast.error(t('errors.fileUnavailable'));
        },
        onError: () => toast.error(t('errors.fileUnavailable')),
    });

    const tone = SHEET_TONE[sheet.status] ?? 'INFO';

    return (
        <li
            className={cn(
                'flex flex-col gap-3 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-start',
                sheet.status === 'NEEDS_REVIEW' ? 'bg-warning-50/40' : 'bg-white'
            )}
        >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                    <span
                        className="max-w-72 truncate font-medium text-neutral-800"
                        title={sheet.file_name ?? ''}
                    >
                        {sheet.file_name || '—'}
                    </span>
                    {sheet.page_no != null && (
                        <span className="text-caption text-neutral-500">
                            {t('review.page', { page: sheet.page_no })}
                        </span>
                    )}
                    <div className="flex items-center gap-1.5">
                        {isOmrSheetActive(sheet) && (
                            <CircleNotch
                                size={14}
                                className="shrink-0 animate-spin text-primary-500"
                            />
                        )}
                        <StatusChip
                            text={t(`sheetStatus.${sheet.status}`, { defaultValue: sheet.status })}
                            textSize="text-caption"
                            status={tone}
                            showIcon={tone !== 'INFO'}
                        />
                    </div>
                    {flagged && (
                        <span className="rounded bg-warning-50 px-1.5 py-0.5 text-caption text-warning-700">
                            {t('review.flaggedCount', { count: flagCount })}
                        </span>
                    )}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-caption text-neutral-500">{t('review.roll')}</dt>
                    <dd className="font-mono text-neutral-800">
                        {sheet.read_roll || '—'}
                        {sheet.roll_low_confidence && (
                            <span className="ms-2 font-sans text-caption text-warning-700">
                                {t('review.rollLowConfidence')}
                            </span>
                        )}
                        {sheet.read_set && (
                            <span className="ms-2 font-sans text-caption text-neutral-500">
                                {t('review.readSet', { code: sheet.read_set })}
                            </span>
                        )}
                    </dd>
                    <dt className="text-caption text-neutral-500">{t('review.learner')}</dt>
                    <dd className="min-w-0">
                        {sheet.matched_name ? (
                            <span className="flex items-center gap-1.5 text-neutral-800">
                                <UserCircle size={16} className="shrink-0 text-primary-500" />
                                {sheet.matched_name}
                                {sheet.status === 'NEEDS_REVIEW' && (
                                    <span className="text-caption text-neutral-500">
                                        {t('review.suggested')}
                                    </span>
                                )}
                            </span>
                        ) : (
                            <span className="text-caption text-neutral-400">—</span>
                        )}
                    </dd>
                    {sheet.status === 'GRADED' && sheet.marks != null && (
                        <>
                            <dt className="text-caption text-neutral-500">{t('review.marks')}</dt>
                            <dd className="font-semibold text-success-700">{sheet.marks}</dd>
                        </>
                    )}
                </dl>
                {sheet.reason && sheet.status !== 'GRADED' && (
                    <p
                        className={cn(
                            'text-caption',
                            sheet.status === 'FAILED' ? 'text-danger-600' : 'text-warning-700'
                        )}
                    >
                        {sheet.reason}
                    </p>
                )}
            </div>

            {sheet.name_crop_file_id && (
                <OmrFileImage
                    fileId={sheet.name_crop_file_id}
                    alt={t('review.nameCropAlt')}
                    className="h-12 w-48 shrink-0"
                />
            )}

            <div className="flex flex-wrap gap-1.5 sm:max-w-72 sm:justify-end">
                {sheet.sheet_file_id && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disabled={open.isPending}
                        onClick={() => sheet.sheet_file_id && open.mutate(sheet.sheet_file_id)}
                    >
                        <FilePdf size={14} />
                        {t('review.viewSheet')}
                    </MyButton>
                )}
                {sheet.marked_file_id && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disabled={open.isPending}
                        onClick={() => sheet.marked_file_id && open.mutate(sheet.marked_file_id)}
                    >
                        <Eye size={14} />
                        {t('review.viewMarks')}
                    </MyButton>
                )}
                {sheet.status === 'NEEDS_REVIEW' && (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        onClick={() => setAssignOpen(true)}
                    >
                        {t('review.assign')}
                    </MyButton>
                )}
                {sheet.status === 'FAILED' && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate()}
                    >
                        {t('review.retry')}
                    </MyButton>
                )}
                {(sheet.status === 'NEEDS_REVIEW' || sheet.status === 'FAILED') && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disabled={skip.isPending}
                        onClick={() => skip.mutate()}
                    >
                        {t('review.skip')}
                    </MyButton>
                )}
                {flagged && (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        onClick={() => setFixOpen(true)}
                    >
                        {t('review.fixAnswers')}
                    </MyButton>
                )}
            </div>

            {assignOpen && (
                <OmrAssignLearnerDialog
                    sheet={sheet}
                    assessmentId={assessmentId}
                    instituteId={instituteId}
                    onClose={() => setAssignOpen(false)}
                    onResolved={() => {
                        setAssignOpen(false);
                        onChanged();
                    }}
                />
            )}
            {fixOpen && (
                <OmrFixAnswersDialog
                    sheet={sheet}
                    instituteId={instituteId}
                    optionCountByNo={optionCountByNo}
                    onClose={() => setFixOpen(false)}
                    onFixed={() => {
                        setFixOpen(false);
                        onChanged();
                    }}
                />
            )}
        </li>
    );
};

export default OmrSheetRow;
