import { useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Eye } from '@phosphor-icons/react';
import { Row } from '@tanstack/react-table';
import { MyButton } from '@/components/design-system/button';
import { StatusChips } from '@/components/design-system/chips';
import { StudentTable } from '@/types/student-table-types';
import { ActivityStatus } from '@/components/design-system/utils/types/chips-types';
import { getInstituteId } from '@/constants/helper';
import { getPublicUrl } from '@/services/upload_file';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { viewStudentReport } from '../-services/assessment-details-services';
import { FilePreviewDialog } from './FilePreviewDialog';
import { Route } from '..';

// Evaluation Status cell: the usual status chip, plus — for MANUAL evaluation
// assessments whose attempt is already evaluated — an eye button that opens the
// evaluated (annotated) copy of the answer sheet.
export const EvaluationStatusCell = ({ row }: { row: Row<StudentTable> }) => {
    const { t } = useTranslation('assessmentEvaluationStatusCell');
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();
    const [isOpening, setIsOpening] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // Cached — same query the submissions tab and row dropdown already use.
    const { data: assessmentData } = useSuspenseQuery(
        getAssessmentDetails({ assessmentId, instituteId, type: 'EXAM' })
    );
    const isManualEvaluation = assessmentData?.[0]?.saved_data?.evaluation_type === 'MANUAL';

    // Submission rows carry extra fields the shared StudentTable type doesn't declare.
    const rowData = row.original as StudentTable & {
        evaluation_status?: string;
        attempt_id?: string;
    };
    const status = rowData.evaluation_status || 'PENDING';
    // API returns: "COMPLETED" | "EVALUATING" | "PENDING"
    // NOTE: statusMapping drives the chip's color/icon lookup (ActivityStatusData
    // keys) — keep these untranslated. Display text is supplied separately via
    // statusLabels below, passed as StatusChips' children.
    const statusMapping: Record<string, ActivityStatus> = {
        COMPLETED: 'evaluated',
        EVALUATING: 'evaluating',
        PENDING: 'pending',
    };
    const mappedStatus = statusMapping[status] || 'pending';
    const statusLabels: Partial<Record<ActivityStatus, string>> = {
        evaluated: t('evaluated'),
        evaluating: t('evaluating'),
        pending: t('pending'),
    };

    // The evaluated copy's file id lives on the report detail, not the table
    // row, so resolve it on click.
    const handleViewEvaluated = async () => {
        if (isOpening || !rowData.attempt_id) return;
        setIsOpening(true);
        try {
            const report = (await viewStudentReport(
                assessmentId,
                rowData.attempt_id,
                instituteId
            )) as { evaluated_file_id?: string | null } | undefined;
            const fileId = report?.evaluated_file_id;
            if (!fileId) {
                toast.error(t('noEvaluatedCopyError'));
                return;
            }
            const url = await getPublicUrl(fileId);
            if (!url) throw new Error('No file URL');
            // In-app preview (see FilePreviewDialog) — a browser tab would
            // download the extension-less file instead of rendering it.
            setPreviewUrl(url);
            setPreviewOpen(true);
        } catch (error) {
            console.error('Failed to load evaluated copy:', error);
            toast.error(t('loadFailedError'));
        } finally {
            setIsOpening(false);
        }
    };

    return (
        <div className="flex items-center gap-2">
            <StatusChips status={mappedStatus}>
                {statusLabels[mappedStatus] ?? mappedStatus}
            </StatusChips>
            {isManualEvaluation && status === 'COMPLETED' && (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className="w-8 !min-w-8"
                    title={t('viewEvaluatedCopy')}
                    disable={isOpening}
                    onClick={handleViewEvaluated}
                >
                    <Eye size={16} />
                </MyButton>
            )}
            <FilePreviewDialog
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                fileUrl={previewUrl}
                heading={t('evaluatedCopyHeading')}
                downloadName={`${t('fileNamePrefix')}-${rowData.full_name || rowData.attempt_id || 'attempt'}`}
            />
        </div>
    );
};
