import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, Coins, WarningCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    getAiStudentReportStatus,
    handleGetAiStudentReportExportPDF,
} from '../../-services/assessment-details-services';

interface StudentAiReportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assessmentId: string;
    attemptId: string;
    instituteId: string | undefined;
    studentName: string;
}

/**
 * The student's AI report, as the learner sees it, downloaded by an admin. The status
 * check is free; the download only spends AI credits when the analysis has never been
 * generated for this attempt, and the dialog says so before the admin confirms.
 */
export function StudentAiReportDialog({
    open,
    onOpenChange,
    assessmentId,
    attemptId,
    instituteId,
    studentName,
}: StudentAiReportDialogProps) {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');

    const statusQuery = useQuery({
        queryKey: ['AI_STUDENT_REPORT_STATUS', assessmentId, attemptId, instituteId],
        queryFn: () => getAiStudentReportStatus(assessmentId, instituteId, attemptId),
        enabled: open,
        staleTime: 0,
    });
    const status = statusQuery.data?.status;
    const unsupported = status === 'UNSUPPORTED';
    const needsGeneration = !!statusQuery.data?.requires_generation;

    const download = useMutation({
        mutationFn: () =>
            handleGetAiStudentReportExportPDF(
                assessmentId,
                instituteId,
                attemptId,
                needsGeneration
            ),
        onSuccess: (blob) => {
            if (!blob) {
                toast.error(t('toasts.aiReportError'));
                return;
            }
            const safeName = (studentName || 'student').replace(/[^\w.-]+/g, '_');
            const url = window.URL.createObjectURL(blob as Blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `AI_Report_${safeName}.pdf`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            toast.success(t('dialogs.aiReport.downloaded'));
            onOpenChange(false);
        },
        onError: () => toast.error(t('toasts.aiReportError')),
    });

    const footer = (
        <div className="flex justify-end gap-2">
            <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                {t('dialogs.cancel')}
            </MyButton>
            <MyButton
                buttonType="primary"
                scale="medium"
                disable={
                    statusQuery.isLoading || unsupported || download.isPending || !statusQuery.data
                }
                onClick={() => download.mutate()}
            >
                {download.isPending
                    ? t('dialogs.aiReport.generating')
                    : needsGeneration
                      ? t('dialogs.aiReport.generateAndDownload')
                      : t('dialogs.aiReport.download')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog
            heading={t('dialogs.aiReport.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={footer}
        >
            <div className="flex flex-col gap-3 p-4 text-body text-neutral-700">
                <p>
                    {t('dialogs.aiReport.intro')} <b>{studentName}</b>
                </p>
                <ul className="list-disc space-y-1 ps-5 text-caption text-neutral-600">
                    <li>{t('dialogs.aiReport.bulletWeakness')}</li>
                    <li>{t('dialogs.aiReport.bulletCharts')}</li>
                    <li>{t('dialogs.aiReport.bulletActions')}</li>
                </ul>
                {statusQuery.isLoading && (
                    <p className="text-caption text-neutral-500">
                        {t('dialogs.aiReport.checking')}
                    </p>
                )}
                {statusQuery.isError && (
                    <p className="text-caption text-danger-600">{t('toasts.aiReportError')}</p>
                )}
                {status === 'AVAILABLE' && (
                    <p className="flex items-start gap-2 rounded-md bg-success-50 p-3 text-caption text-success-700">
                        <CheckCircle size={16} className="mt-0.5 shrink-0" />
                        {t('dialogs.aiReport.alreadyGenerated')}
                    </p>
                )}
                {needsGeneration && (
                    <p className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-caption text-warning-700">
                        <Coins size={16} className="mt-0.5 shrink-0" />
                        {t('dialogs.aiReport.usesCredits')}
                    </p>
                )}
                {unsupported && (
                    <p className="flex items-start gap-2 rounded-md bg-neutral-50 p-3 text-caption text-neutral-600">
                        <WarningCircle size={16} className="mt-0.5 shrink-0" />
                        {t('dialogs.aiReport.unsupported')}
                    </p>
                )}
            </div>
        </MyDialog>
    );
}
